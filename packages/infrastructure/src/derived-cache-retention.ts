import type { PoolClient } from 'pg';
import { ModuleServiceError } from '@proanima/arkvory-extension-api';
import { cacheLock } from './derived-cache-runtime.js';
import { cacheTransaction, lockedGeneration, type CacheState } from './derived-cache-db.js';

export interface CacheCandidate {
  id: string;
  owner: string;
  state: CacheState;
}

/** Only the parent admission path requests ready victims. No timer evicts ready data.
 * Reconcile owner-quiescent buildings one entry at a time in normal lock order. */
export async function cacheCandidates(
  client: PoolClient,
  moduleId: string,
  evict: boolean,
  limit: number,
): Promise<CacheCandidate[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new ModuleServiceError('invalid_input');
  const result = await client.query<CacheCandidate>(
    `SELECT g.id,g.owner_id AS owner,g.state FROM arkvory_derived_cache_generations g
     JOIN arkvory_derived_cache_owners o ON o.id=g.owner_id
     JOIN arkvory_derived_cache_entries e ON e.module_id=g.module_id AND e.key=g.key
     WHERE g.module_id=$1 AND (g.state<>'building' OR o.quiescent)
       AND ($3 OR g.state<>'ready')
     ORDER BY CASE WHEN g.state='ready' THEN 1 ELSE 0 END,e.last_access,g.id LIMIT $2`,
    [moduleId, limit, evict],
  );
  for (const candidate of result.rows) {
    if (candidate.state !== 'building') continue;
    await cacheTransaction(client, async () => {
      const row = await lockedGeneration(client, moduleId, candidate.id);
      if (!row || row.state !== 'building') return;
      const retired = await client.query(
        `UPDATE arkvory_derived_cache_generations g
        SET state='retired',retired_at=now() FROM arkvory_derived_cache_owners o
        WHERE g.id=$1 AND o.id=g.owner_id AND o.quiescent`,
        [row.id],
      );
      if (!retired.rowCount) return;
      await client.query(
        `UPDATE arkvory_derived_cache_entries SET building_id=NULL
        WHERE module_id=$1 AND key=$2 AND building_id=$3`,
        [moduleId, row.key, row.id],
      );
      candidate.state = 'retired';
    });
  }
  return result.rows;
}

/** Success retains exclusive session pin through physical deletion, then caller unlocks.
 * Reader-session loss is insufficient: non-quiescent persisted read refs always block. */
export async function startCacheDelete(
  client: PoolClient,
  moduleId: string,
  id: string,
): Promise<boolean> {
  const pinState = { held: false };
  try {
    const accepted = await cacheTransaction(client, async () => {
      const row = await lockedGeneration(client, moduleId, id);
      if (!row) return false;
      const eligibility = await client.query<{ safe: boolean }>(
        `SELECT (g.io_quiescent OR o.quiescent) AND NOT EXISTS (
          SELECT 1 FROM arkvory_derived_cache_read_refs r
          JOIN arkvory_derived_cache_owners ro ON ro.id=r.owner_id
          WHERE r.generation_id=g.id AND NOT ro.quiescent) AS safe
         FROM arkvory_derived_cache_generations g JOIN arkvory_derived_cache_owners o ON o.id=g.owner_id
         WHERE g.id=$1`,
        [id],
      );
      if (!eligibility.rows[0]?.safe) return false;
      const pin = await client.query<{ acquired: boolean }>(
        'SELECT pg_try_advisory_lock($1::bigint) AS acquired',
        [cacheLock('generation', id)],
      );
      if (!pin.rows[0]?.acquired) return false;
      pinState.held = true;
      await client.query(
        `UPDATE arkvory_derived_cache_entries
        SET current_id=CASE WHEN current_id=$3 THEN NULL ELSE current_id END,
            building_id=CASE WHEN building_id=$3 THEN NULL ELSE building_id END
        WHERE module_id=$1 AND key=$2`,
        [moduleId, row.key, id],
      );
      await client.query(
        "UPDATE arkvory_derived_cache_generations SET state='deleting' WHERE id=$1",
        [id],
      );
      return true;
    });
    return accepted;
  } catch (error) {
    if (pinState.held)
      await client
        .query('SELECT pg_advisory_unlock($1::bigint)', [cacheLock('generation', id)])
        .catch(() => undefined);
    throw error;
  }
}

/** Caller must still hold the exclusive generation pin and have confirmed physical deletion.
 * Never delete an owner row: its quiescence is terminal and its UUID cannot be reused. */
export async function removeCacheMetadata(
  client: PoolClient,
  moduleId: string,
  id: string,
): Promise<void> {
  await cacheTransaction(client, async () => {
    const row = await lockedGeneration(client, moduleId, id);
    if (!row) return;
    if (row.state !== 'deleting') throw new ModuleServiceError('conflict');
    await client.query(
      `DELETE FROM arkvory_derived_cache_read_refs r USING arkvory_derived_cache_owners o
      WHERE r.generation_id=$1 AND r.owner_id=o.id AND o.quiescent`,
      [id],
    );
    // FK refuses to drop metadata if even one un-drained reader survived.
    await client.query(
      'DELETE FROM arkvory_derived_cache_generations WHERE module_id=$1 AND id=$2',
      [moduleId, id],
    );
    await client.query(
      `DELETE FROM arkvory_derived_cache_entries e WHERE module_id=$1 AND key=$2
      AND current_id IS NULL AND building_id IS NULL AND NOT EXISTS
      (SELECT 1 FROM arkvory_derived_cache_generations g WHERE g.module_id=e.module_id AND g.key=e.key)`,
      [moduleId, row.key],
    );
  });
}
