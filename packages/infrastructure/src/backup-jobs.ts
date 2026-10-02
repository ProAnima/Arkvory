import type { Pool, PoolClient } from 'pg';
import {
  BackupFailure,
  backupJobStates,
  backupPhases,
  backupTransitionAllowed,
  captureReuse,
  hasLiveAttempt,
  requireId,
} from '@proanima/arkvory-domain';
import type { BackupFailureCode, BackupJobState, BackupPhase } from '@proanima/arkvory-domain';
import type { CaptureJobs, CaptureLease, CaptureStart } from '@proanima/arkvory-application';
import { inTransaction } from './pg-transaction.js';
import { RenewedCaptureLease } from './backup-lease.js';

export const MAX_CAPTURE_ATTEMPTS = 5;

export interface BackupJobOptions {
  /** Random id of this process; written as lease_owner. */
  readonly owner: string;
  readonly leaseSeconds: number;
}
interface JobRow {
  id: string;
  state: BackupJobState;
  attempts: number;
  generation: string;
  point_id: string;
  vault_id: string;
  idempotency_key: string;
  expired: boolean;
}
const jobColumns = `id::text, state, attempts, generation::text, point_id::text, vault_id::text,
  idempotency_key, COALESCE(lease_until<now(), true) AS expired`;

const liveStates = backupJobStates.filter(hasLiveAttempt);

/** States from which `to` may be reached, as defined by the domain transition table. */
function sources(to: BackupJobState): string[] {
  return backupJobStates.filter((from) => backupTransitionAllowed(from, to));
}

function lost(): BackupFailure {
  return new BackupFailure('lease_lost', 'Capture attempt was fenced or its lease expired');
}

/**
 * Stale owner → interrupted under a new generation, its pins released and a barrier it holds
 * reopened, in the caller's transaction. Only an expired lease may be fenced, so a live owner
 * keeps every guarantee until it stops renewing.
 */
async function fenceCapture(client: PoolClient, id: string, generation: string) {
  const fenced = await client.query(
    `UPDATE arkvory_backup_jobs SET state='interrupted', error_code='interrupted',
      generation=generation+1, lease_owner=NULL, lease_until=NULL, updated_at=clock_timestamp()
     WHERE id=$1 AND generation=$2 AND state=ANY($3::text[]) AND lease_until<now()`,
    [id, generation, sources('interrupted')],
  );
  if (fenced.rowCount !== 1) return false;
  await releaseCapture(client, id);
  return true;
}

async function releaseCapture(client: PoolClient, id: string): Promise<void> {
  await client.query('DELETE FROM arkvory_backup_pins WHERE job_id=$1', [id]);
  await client.query(
    `UPDATE arkvory_backup_barrier SET state='open', job_id=NULL, generation=NULL,
      changed_at=clock_timestamp() WHERE job_id=$1`,
    [id],
  );
}

/** PostgreSQL capture jobs: idempotency key, lease with fencing generation, bounded attempts. */
export class PostgresBackupJobs implements CaptureJobs {
  private readonly leaseMs: number;
  constructor(
    private readonly pool: Pool,
    private readonly options: BackupJobOptions,
  ) {
    requireId(options.owner);
    if (
      !Number.isSafeInteger(options.leaseSeconds) ||
      options.leaseSeconds < 1 ||
      options.leaseSeconds > 3600
    )
      throw new BackupFailure('invalid_argument', 'Invalid capture lease duration');
    this.leaseMs = options.leaseSeconds * 1000;
  }

  async start(request: {
    idempotencyKey: string;
    vaultId: string;
    jobId: string;
    pointId: string;
  }): Promise<CaptureStart> {
    const grantedAt = performance.now();
    const outcome = await inTransaction(this.pool, async (client) => {
      const active = await client.query<JobRow>(
        `SELECT ${jobColumns} FROM arkvory_backup_jobs WHERE state=ANY($1::text[]) FOR UPDATE`,
        [liveStates],
      );
      for (const job of active.rows) {
        const decision = captureReuse({ ...job, leaseExpired: job.expired }, MAX_CAPTURE_ATTEMPTS);
        if (decision.action === 'busy')
          throw new BackupFailure('busy', 'Another capture holds a live lease');
        await fenceCapture(client, job.id, job.generation);
      }
      const existing = (
        await client.query<JobRow>(
          `SELECT ${jobColumns} FROM arkvory_backup_jobs WHERE idempotency_key=$1 FOR UPDATE`,
          [request.idempotencyKey],
        )
      ).rows[0];
      if (!existing) return this.insert(client, request);
      if (existing.vault_id !== request.vaultId)
        throw new BackupFailure('invalid_argument', 'Idempotency key belongs to another vault');
      const decision = captureReuse(
        { state: existing.state, attempts: existing.attempts, leaseExpired: existing.expired },
        MAX_CAPTURE_ATTEMPTS,
      );
      switch (decision.action) {
        case 'return_completed':
          return { kind: 'completed' as const, jobId: existing.id, pointId: existing.point_id };
        case 'retry':
          return this.retry(client, existing);
        case 'exhausted':
          throw new BackupFailure('attempts_exhausted', 'Capture attempts are exhausted');
        case 'busy':
        case 'fence':
          // Active jobs were fenced above; reaching this means a concurrent writer won.
          throw new BackupFailure('busy', 'Capture job changed concurrently');
      }
    });
    if (outcome.kind === 'completed') return outcome;
    return {
      kind: 'started',
      lease: new RenewedCaptureLease(
        { ...outcome.lease, owner: this.options.owner },
        this.leaseMs,
        (lease) => this.heartbeat(lease),
        grantedAt,
      ),
    };
  }

  private async insert(
    client: PoolClient,
    request: { idempotencyKey: string; vaultId: string; jobId: string; pointId: string },
  ) {
    try {
      await client.query(
        `INSERT INTO arkvory_backup_jobs(id,kind,state,phase,idempotency_key,vault_id,point_id,
          lease_owner,lease_until) VALUES($1,'capture','running','barrier',$2,$3,$4,$5,
          now()+make_interval(secs=>$6))`,
        [
          requireId(request.jobId),
          request.idempotencyKey,
          requireId(request.vaultId),
          requireId(request.pointId),
          this.options.owner,
          this.options.leaseSeconds,
        ],
      );
    } catch (error) {
      // The partial unique index admits one unfinished capture per database.
      if (error instanceof Error && 'code' in error && error.code === '23505')
        throw new BackupFailure('busy', 'Another capture started concurrently', { cause: error });
      throw error;
    }
    const lease = { jobId: request.jobId, pointId: request.pointId, generation: 1, attempt: 1 };
    return { kind: 'started' as const, lease };
  }

  private async retry(client: PoolClient, job: JobRow) {
    const updated = await client.query<{ generation: string; attempts: number }>(
      `UPDATE arkvory_backup_jobs SET state='running', phase='barrier', attempts=attempts+1,
        generation=generation+1, lease_owner=$2, lease_until=now()+make_interval(secs=>$3),
        error_code=NULL, snapshot_at=NULL, updated_at=clock_timestamp()
       WHERE id=$1 AND state=ANY($4::text[]) RETURNING generation::text, attempts`,
      [job.id, this.options.owner, this.options.leaseSeconds, sources('running')],
    );
    const row = updated.rows[0];
    if (!row) throw new BackupFailure('busy', 'Capture job changed concurrently');
    const lease = {
      jobId: job.id,
      pointId: job.point_id,
      generation: Number(row.generation),
      attempt: row.attempts,
    };
    return { kind: 'started' as const, lease };
  }

  private async heartbeat(lease: RenewedCaptureLease): Promise<boolean> {
    const renewed = await this.pool.query(
      `UPDATE arkvory_backup_jobs SET lease_until=now()+make_interval(secs=>$4),
        updated_at=clock_timestamp()
       WHERE id=$1 AND generation=$2 AND lease_owner=$3 AND state=ANY($5::text[])
       AND lease_until>now()`,
      [lease.jobId, lease.generation, this.options.owner, this.options.leaseSeconds, liveStates],
    );
    return renewed.rowCount === 1;
  }

  /** Writes that extend progress need a lease that has not lapsed in the database. */
  private async fenced(
    lease: CaptureLease,
    change: { set: string; from: BackupJobState; values: unknown[]; where?: string },
  ) {
    lease.throwIfAborted();
    const { set, from, values, where } = change;
    const result = await this.pool.query(
      `UPDATE arkvory_backup_jobs SET ${set}, updated_at=clock_timestamp()
       WHERE id=$1 AND generation=$2 AND lease_owner=$3 AND state=$4 AND lease_until>now()
       ${where ?? ''}`,
      [lease.jobId, lease.generation, this.options.owner, from, ...values],
    );
    if (result.rowCount !== 1) throw lost();
  }

  async advance(lease: CaptureLease, phase: BackupPhase): Promise<void> {
    // Phases only move forward; the order is the domain list passed as $6.
    await this.fenced(lease, {
      set: 'phase=$5',
      from: 'running',
      values: [phase, backupPhases],
      where: 'AND array_position($6::text[], phase) < array_position($6::text[], $5::text)',
    });
  }

  async committing(lease: CaptureLease, snapshotAt: string | null): Promise<void> {
    await this.fenced(lease, {
      set: "state='committing', phase='commit', snapshot_at=$5",
      from: 'running',
      values: [snapshotAt],
    });
  }

  async complete(lease: CaptureLease): Promise<void> {
    // The point is already committed: generation equality suffices, an expired lease is fine.
    await inTransaction(this.pool, async (client) => {
      const done = await client.query(
        `UPDATE arkvory_backup_jobs SET state='completed', phase='done',
          completed_at=clock_timestamp(), lease_owner=NULL, lease_until=NULL,
          updated_at=clock_timestamp()
         WHERE id=$1 AND generation=$2 AND state=ANY($3::text[])`,
        [lease.jobId, lease.generation, sources('completed')],
      );
      if (done.rowCount !== 1) throw lost();
      await releaseCapture(client, lease.jobId);
    });
  }

  async fail(lease: CaptureLease, code: BackupFailureCode): Promise<void> {
    await inTransaction(this.pool, async (client) => {
      const failed = await client.query(
        `UPDATE arkvory_backup_jobs SET state='failed', error_code=$3, lease_owner=NULL,
          lease_until=NULL, updated_at=clock_timestamp()
         WHERE id=$1 AND generation=$2 AND state=ANY($4::text[])`,
        [lease.jobId, lease.generation, code, sources('failed')],
      );
      // A fenced attempt already gave its pins back; nothing is left to release.
      if (failed.rowCount === 1) await releaseCapture(client, lease.jobId);
    });
  }
}
