import type { Pool, PoolClient } from 'pg';
import { BackupFailure } from '@proanima/arkvory-domain';
import type { CaptureLease, CapturePins, UnlinkBarrier } from '@proanima/arkvory-application';
import { inTransaction } from './pg-transaction.js';

export interface BarrierOptions {
  /** Bound for already admitted unlinks to finish before the capture gives up. */
  readonly waitMs: number;
}
export const defaultBarrierOptions: BarrierOptions = { waitMs: 30000 };

/** Row lock on the job serializes pin/barrier writes with fencing (UPDATE … FOR UPDATE). */
async function lockLiveAttempt(client: PoolClient, lease: CaptureLease): Promise<void> {
  const row = await client.query(
    `SELECT 1 FROM arkvory_backup_jobs WHERE id=$1 AND generation=$2 AND state='running'
     AND lease_until>now() FOR SHARE`,
    [lease.jobId, lease.generation],
  );
  if (row.rowCount !== 1)
    throw new BackupFailure('lease_lost', 'Capture attempt was fenced or its lease expired');
}

/**
 * Writers and maintenance tools that hold the writer lock 18471/3 must also hold the backup
 * protocol mark 18471/20; an older binary would ignore pins and the barrier.
 */
async function requireProtocol(client: PoolClient): Promise<void> {
  const legacy = await client.query(`SELECT 1 FROM pg_locks w WHERE w.locktype='advisory'
    AND w.classid=18471 AND w.objid=3 AND w.objsubid=2 AND w.granted
    AND w.database=(SELECT oid FROM pg_database WHERE datname=current_database())
    AND NOT EXISTS(SELECT 1 FROM pg_locks m WHERE m.pid=w.pid AND m.locktype='advisory'
      AND m.classid=18471 AND m.objid=20 AND m.objsubid=2 AND m.granted)`);
  if (legacy.rowCount)
    throw new BackupFailure('upgrade_required', 'A running writer does not support backup pins');
}

/**
 * Unlink admission barrier (see unlink-admission.ts for the deleter side). close() runs on a
 * dedicated session that is destroyed afterwards, so the exclusive lock can never outlive it:
 *   1. pg_advisory_lock(18471,18) with lock_timeout — waits for admitted unlinks to finish;
 *   2. durable `closed` row for this job/generation, committed while the lock is held;
 *   3. unlock. From here every admission reads `closed`, even if this session is lost.
 */
export class PostgresUnlinkBarrier implements UnlinkBarrier {
  constructor(
    private readonly pool: Pool,
    private readonly options: BarrierOptions = defaultBarrierOptions,
  ) {
    if (!Number.isSafeInteger(options.waitMs) || options.waitMs < 1)
      throw new BackupFailure('invalid_argument', 'Invalid barrier wait');
  }

  async close(lease: CaptureLease): Promise<void> {
    lease.throwIfAborted();
    const client = await this.pool.connect();
    try {
      await requireProtocol(client);
      await client.query(`SET lock_timeout = ${String(this.options.waitMs)}`);
      try {
        await client.query('SELECT pg_advisory_lock(18471,18)');
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === '55P03')
          throw new BackupFailure('barrier_timeout', 'Admitted unlinks did not finish in time', {
            cause: error,
          });
        throw error;
      }
      await client.query('BEGIN');
      await lockLiveAttempt(client, lease);
      const closed = await client.query(
        `UPDATE arkvory_backup_barrier SET state='closed', job_id=$1, generation=$2,
          changed_at=clock_timestamp() WHERE singleton AND state='open'`,
        [lease.jobId, lease.generation],
      );
      if (closed.rowCount !== 1)
        throw new BackupFailure('busy', 'The unlink barrier is held by another capture');
      await client.query('COMMIT');
      await client.query('SELECT pg_advisory_unlock(18471,18)');
    } finally {
      // Destroying the session also drops the advisory lock and settings on every error path.
      client.release(true);
    }
  }

  async reopen(lease: CaptureLease): Promise<void> {
    lease.throwIfAborted();
    const reopened = await this.pool.query(
      `UPDATE arkvory_backup_barrier b SET state='open', job_id=NULL, generation=NULL,
        changed_at=clock_timestamp()
       WHERE b.singleton AND b.job_id=$1 AND b.generation=$2 AND EXISTS(
         SELECT 1 FROM arkvory_backup_jobs j WHERE j.id=$1 AND j.generation=$2
         AND j.state='running')`,
      [lease.jobId, lease.generation],
    );
    if (reopened.rowCount !== 1)
      throw new BackupFailure('lease_lost', 'Barrier no longer belongs to this attempt');
  }
}

/** Durable pins of immutable content ids; a fenced attempt cannot add pins after its fence. */
export class PostgresCapturePins implements CapturePins {
  constructor(private readonly pool: Pool) {}

  async pin(lease: CaptureLease, ids: readonly string[]): Promise<void> {
    if (!ids.length) return;
    lease.throwIfAborted();
    await inTransaction(this.pool, async (client) => {
      await lockLiveAttempt(client, lease);
      await client.query(
        `INSERT INTO arkvory_backup_pins(upload_id, job_id)
         SELECT unnest($2::uuid[]), $1 ON CONFLICT DO NOTHING`,
        [lease.jobId, ids],
      );
    });
  }
}
