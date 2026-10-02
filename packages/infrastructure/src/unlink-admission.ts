import type { PoolClient } from 'pg';
import { requireId } from '@proanima/arkvory-domain';

/**
 * Backup unlink admission (ADR 0054). Every physical removal of published content runs as:
 *
 *   per-object upload lock → content lock → admitUnlink (18471,18 shared, try) → unlink →
 *   finishUnlink
 *
 * A capture takes 18471/18 exclusively, alone on its own session and never while holding object
 * locks, to wait for removals already admitted; it then records the durable `closed` barrier,
 * releases the lock and opens snapshot T. Deleters only ever try-lock, so no wait cycle exists.
 * An admission is refused while the barrier is closed or while any backup pin names the id; the
 * durable row keeps refusing even when the capture session that closed it is lost.
 */
export const UNLINK_ADMISSION_LOCK = 18;
/** Held shared by every runtime session that honours pins and the barrier (storage claim). */
export const BACKUP_PROTOCOL_LOCK = 20;

/** True when the caller may unlink the content of `id` now; it must call finishUnlink after. */
export async function admitUnlink(client: PoolClient, id: string): Promise<boolean> {
  const lock = await client.query<{ acquired: boolean }>(
    'SELECT pg_try_advisory_lock_shared(18471,18) AS acquired',
  );
  if (lock.rows[0]?.acquired !== true) return false;
  try {
    const state = await client.query<{ open: boolean; pinned: boolean }>(
      `SELECT b.state='open' AS open,
         EXISTS(SELECT 1 FROM arkvory_backup_pins p WHERE p.upload_id=$1) AS pinned
       FROM arkvory_backup_barrier b WHERE b.singleton`,
      [requireId(id)],
    );
    const row = state.rows[0];
    // A missing barrier row is treated as closed: deletion is never the default.
    if (row?.open === true && !row.pinned) return true;
  } catch (error) {
    await finishUnlink(client);
    throw error;
  }
  await finishUnlink(client);
  return false;
}

export async function finishUnlink(client: PoolClient): Promise<void> {
  await client.query('SELECT pg_advisory_unlock_shared(18471,18)');
}
