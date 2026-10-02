import type { Pool, PoolClient } from 'pg';
import { setTimeout as delay } from 'node:timers/promises';
import { ArkvoryError, parseCleanupPolicy } from '@proanima/arkvory-domain';
import type { CleanupBlobs } from '@proanima/arkvory-application';
import { StorageOwnership } from './storage-ownership.js';
import { contentLockKey, uploadLockKey } from './content-pins.js';
import { recordStorageEvent } from './storage-events.js';
import { admitUnlink, finishUnlink } from './unlink-admission.js';

interface Candidate {
  id: string;
  status: string;
  size: string;
}
interface Result {
  collected: number;
  deferred: number;
  failed: number;
  bytes: bigint;
  error: string | null;
}
const unpinned = `NOT EXISTS(SELECT 1 FROM arkvory_references WHERE artifact_id=u.id)
  AND NOT EXISTS(SELECT 1 FROM arkvory_assets WHERE artifact_id=u.id)
  AND NOT EXISTS(SELECT 1 FROM arkvory_asset_revisions WHERE artifact_id=u.id)
  AND NOT EXISTS(SELECT 1 FROM arkvory_attachment_targets WHERE target_id=u.id)`;

/** Bounded physical maintenance. SQL transactions never span filesystem work. */
export class PostgresOnlineCleanup {
  constructor(
    private readonly pool: Pool,
    private readonly blobs: CleanupBlobs,
  ) {}
  async tick(active: () => boolean) {
    if (!active()) return;
    const c = await this.pool.connect();
    const ownership = new StorageOwnership(c);
    const check = () => {
      if (!ownership.active || !active())
        throw new ArkvoryError('unavailable', 'Cleanup ownership lost');
    };
    try {
      const lock = await c.query<{ acquired: boolean }>(
        'SELECT pg_try_advisory_lock(18471,16) AS acquired',
      );
      if (!lock.rows[0]?.acquired) return;
      await ownership.start([16]);
      // Older gateways have no content pins. Defer collection until all active processes support them.
      const legacy = await c.query(`SELECT 1 FROM pg_locks p WHERE p.locktype='advisory'
        AND p.classid=18471 AND p.objid=4 AND p.objsubid=2 AND p.granted
        AND p.database=(SELECT oid FROM pg_database WHERE datname=current_database())
        AND NOT EXISTS(SELECT 1 FROM pg_locks n WHERE n.pid=p.pid AND n.locktype='advisory'
          AND n.classid=18471 AND n.objid=17 AND n.objsubid=2 AND n.granted)`);
      const due = (
        await c.query<{ repository: string }>(`SELECT repository FROM arkvory_cleanup_settings
        WHERE policy->>'enabled'='true' AND next_run_at<=now() ORDER BY next_run_at,repository LIMIT 1`)
      ).rows[0];
      if (!due) return;
      if (legacy.rowCount) {
        await c.query(
          `UPDATE arkvory_cleanup_settings SET last_error='upgrade_required',next_run_at=now()+interval '1 minute' WHERE repository=$1`,
          [due.repository],
        );
        return;
      }
      await this.batch(c, due.repository, check);
    } finally {
      await ownership.close();
    }
  }

  private async batch(c: PoolClient, repository: string, check: () => void) {
    const row = (
      await c.query<{ policy: unknown; revision: number }>(
        'SELECT policy,revision FROM arkvory_cleanup_settings WHERE repository=$1',
        [repository],
      )
    ).rows[0];
    if (!row) return;
    const policy = parseCleanupPolicy(row.policy);
    if (!policy.enabled) return;
    const result: Result = { collected: 0, deferred: 0, failed: 0, bytes: 0n, error: null };
    const rows = await c.query<Candidate>(
      `SELECT id,status,size::text FROM arkvory_uploads WHERE repository=$1
      AND NOT reclaimed AND (status<>'available' OR NOT temp_cleaned)
      AND ((status='pending' AND expires_at<=now()) OR (status='available' AND NOT temp_cleaned)
        OR (status='cancelled' AND NOT reclaimed AND cancelled_at<=now()-make_interval(hours=>$2)))
      AND gc_checked_at<=now()-interval '5 seconds' ORDER BY gc_checked_at,id LIMIT $3`,
      [repository, policy.graceHours, policy.batchSize],
    );
    for (const item of rows.rows) {
      check();
      // A pause or changed policy takes effect between objects, never halfway through unlink/accounting.
      const current = await c.query(
        `SELECT 1 FROM arkvory_cleanup_settings WHERE repository=$1 AND revision=$2 AND policy->>'enabled'='true'`,
        [repository, row.revision],
      );
      if (!current.rowCount) break;
      try {
        await this.collect(c, repository, item, policy.graceHours, result, check);
      } catch (error) {
        check();
        result.failed++;
        result.error = error instanceof ArkvoryError ? error.code : 'unavailable';
      }
      await delay(policy.delayMilliseconds);
    }
    check();
    await c.query('BEGIN');
    try {
      await c.query(
        `UPDATE arkvory_cleanup_settings SET last_run_at=now(),last_collected=$3,last_deferred=$4,
      last_failed=$5,last_reclaimed_bytes=$6,last_error=$7,
      next_run_at=CASE WHEN revision=$2 THEN now()+make_interval(secs=>$8) ELSE next_run_at END WHERE repository=$1`,
        [
          repository,
          row.revision,
          result.collected,
          result.deferred,
          result.failed,
          result.bytes.toString(),
          result.error,
          policy.intervalSeconds,
        ],
      );
      if (result.collected || result.deferred || result.failed)
        await recordStorageEvent(
          c,
          repository,
          result.failed ? 'error' : 'info',
          'cleanup.completed',
          {
            collected: result.collected,
            deferred: result.deferred,
            failed: result.failed,
            reclaimedBytes: result.bytes.toString(),
            reason: result.error ?? 'none',
          },
        );
      await c.query('COMMIT');
    } catch (error) {
      await c.query('ROLLBACK');
      throw error;
    }
  }
  private async collect(
    c: PoolClient,
    repository: string,
    item: Candidate,
    grace: number,
    result: Result,
    check: () => void,
  ) {
    const uploadKey = uploadLockKey(item.id),
      contentKey = contentLockKey(item.id);
    let upload = false,
      content = false,
      admitted = false;
    try {
      upload =
        (
          await c.query<{ acquired: boolean }>(
            'SELECT pg_try_advisory_lock($1::bigint) AS acquired',
            [uploadKey],
          )
        ).rows[0]?.acquired ?? false;
      content =
        upload &&
        item.status === 'cancelled' &&
        ((
          await c.query<{ acquired: boolean }>(
            'SELECT pg_try_advisory_lock($1::bigint) AS acquired',
            [contentKey],
          )
        ).rows[0]?.acquired ??
          false);
      await c.query('UPDATE arkvory_uploads SET gc_checked_at=now() WHERE id=$1', [item.id]);
      // Temporary parts are disjoint from published content: their cleanup must not gate downloads.
      if (!upload || (item.status === 'cancelled' && !content)) {
        result.deferred++;
        return;
      }
      check();
      if (item.status === 'pending') {
        await c.query(
          `UPDATE arkvory_uploads SET status='cancelled',cancelled_at=now() WHERE id=$1 AND status='pending' AND expires_at<=now()`,
          [item.id],
        );
        return;
      }
      const eligible = await c.query(
        `SELECT 1 FROM arkvory_uploads u WHERE id=$1 AND repository=$2 AND status=$4 AND
        ((status='available' AND NOT temp_cleaned) OR
        (status='cancelled' AND NOT reclaimed AND cancelled_at<=now()-make_interval(hours=>$3) AND ${unpinned}))`,
        [item.id, repository, grace, item.status],
      );
      if (!eligible.rowCount) {
        result.deferred++;
        return;
      }
      check();
      // Lock order: upload → content → backup unlink admission (unlink-admission.ts).
      if (item.status === 'cancelled') {
        admitted = await admitUnlink(c, item.id);
        if (!admitted) {
          // A backup pin or a closed barrier keeps the bytes; a later pass retries.
          result.deferred++;
          return;
        }
      }
      await this.blobs.collect(item.id, item.status === 'cancelled', { throwIfAborted: check });
      check();
      // Retry after crash is safe: unlink is idempotent; quota is released only after durable deletion.
      const reclaimed = await c.query(
        `UPDATE arkvory_uploads SET temp_cleaned=true,
        reclaimed=CASE WHEN status='cancelled' THEN true ELSE reclaimed END WHERE id=$1 AND status=$2 RETURNING size::text`,
        [item.id, item.status],
      );
      if (reclaimed.rowCount) {
        result.collected++;
        if (item.status === 'cancelled') result.bytes += BigInt(item.size);
      }
    } finally {
      if (admitted) await finishUnlink(c);
      if (content) await c.query('SELECT pg_advisory_unlock($1::bigint)', [contentKey]);
      if (upload) await c.query('SELECT pg_advisory_unlock($1::bigint)', [uploadKey]);
    }
  }
}
