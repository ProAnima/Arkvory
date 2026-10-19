import type { PoolClient } from 'pg';
import { cacheLock, requireKey } from './derived-cache-runtime.js';
import { activeOwner, cacheTransaction } from './derived-cache-db.js';

/** Caller owns a dedicated reader connection and must drop it on uncertain commit failure.
 * The pin is session-scoped; a persisted ref keeps charging even if that session disappears. */
export async function openCacheRead(
  client: PoolClient,
  moduleId: string,
  owner: string,
  key: string,
  readId: string,
): Promise<{ id: string; manifestHash: string } | null> {
  requireKey(key);
  let pinned: string | undefined;
  try {
    return await cacheTransaction(client, async () => {
      if (!(await activeOwner(client, owner))) return null;
      const entry = await client.query<{ current_id: string | null }>(
        'SELECT current_id FROM arkvory_derived_cache_entries WHERE module_id=$1 AND key=$2 FOR UPDATE',
        [moduleId, key],
      );
      const id = entry.rows[0]?.current_id;
      if (!id) return null;
      const generation = await client.query<{ manifest_hash: string }>(
        `SELECT manifest_hash FROM arkvory_derived_cache_generations WHERE module_id=$1 AND id=$2 AND state='ready'`,
        [moduleId, id],
      );
      const row = generation.rows[0];
      if (!row) return null;
      const pin = await client.query<{ acquired: boolean }>(
        'SELECT pg_try_advisory_lock_shared($1::bigint) AS acquired',
        [cacheLock('generation', id)],
      );
      if (!pin.rows[0]?.acquired) return null;
      pinned = id;
      await client.query(
        `INSERT INTO arkvory_derived_cache_read_refs(id,generation_id,owner_id) VALUES($1,$2,$3)`,
        [readId, id, owner],
      );
      await client.query(
        'UPDATE arkvory_derived_cache_entries SET last_access=now() WHERE module_id=$1 AND key=$2',
        [moduleId, key],
      );
      return { id, manifestHash: row.manifest_hash };
    });
  } catch (error) {
    if (pinned)
      await client
        .query('SELECT pg_advisory_unlock_shared($1::bigint)', [cacheLock('generation', pinned)])
        .catch(() => undefined);
    // Unknown COMMIT outcome may leave a conservative ref; owner shutdown/recovery drains it.
    throw error;
  }
}
