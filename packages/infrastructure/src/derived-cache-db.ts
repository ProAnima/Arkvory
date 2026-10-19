import type { Pool, PoolClient } from 'pg';
import { ModuleServiceError } from '@proanima/arkvory-extension-api';
import { cacheLock, type CacheBudget } from './derived-cache-runtime.js';

export type CacheState = 'building' | 'ready' | 'retired' | 'deleting';
export interface CacheRow {
  id: string;
  owner: string;
  state: CacheState;
  key: string;
  manifest_hash: string | null;
  io_quiescent: boolean;
}

/** Caller serializes this client; admission additionally holds ModuleDataAccounting.run.
 * No transaction in this module may enclose filesystem I/O. */
export async function cacheTransaction<T>(client: PoolClient, work: () => Promise<T>): Promise<T> {
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL statement_timeout='15s'");
    const result = await work();
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

export function counts(value: CacheBudget): void {
  if (
    !Number.isSafeInteger(value.bytes) ||
    value.bytes < 0 ||
    !Number.isSafeInteger(value.files) ||
    value.files < 0
  )
    throw new ModuleServiceError('invalid_input');
}

/** SUM includes lost-owner and deleting reservations. Never silently query an old schema:
 * the runtime must require migration 49 before installing the reservedUsage callback. */
export async function cacheUsageExact(
  pool: Pick<Pool, 'query'>,
  moduleId: string,
): Promise<{ bytes: bigint; files: bigint }> {
  const result = await pool.query<{ bytes: string; files: string }>(
    `SELECT coalesce(sum(reserve_bytes),0)::text AS bytes,
      coalesce(sum(reserve_files),0)::text AS files
     FROM arkvory_derived_cache_generations WHERE module_id=$1`,
    [moduleId],
  );
  const row = result.rows[0];
  return { bytes: BigInt(row?.bytes ?? '0'), files: BigInt(row?.files ?? '0') };
}

export async function derivedCacheUsage(
  pool: Pick<Pool, 'query'>,
  moduleId: string,
): Promise<CacheBudget> {
  const usage = await cacheUsageExact(pool, moduleId);
  const ceiling = BigInt(Number.MAX_SAFE_INTEGER);
  // Legacy quota counters are numbers: saturate instead of rounding or granting credit.
  return {
    bytes: Number(usage.bytes > ceiling ? ceiling : usage.bytes),
    files: Number(usage.files > ceiling ? ceiling : usage.files),
  };
}

export async function activeOwner(client: PoolClient, owner: string): Promise<boolean> {
  const result = await client.query(
    'SELECT id FROM arkvory_derived_cache_owners WHERE id=$1 AND NOT quiescent FOR SHARE',
    [owner],
  );
  return result.rowCount === 1;
}

/** Lock entry before generation, matching open/publication/deletion. */
export async function lockedGeneration(
  client: PoolClient,
  moduleId: string,
  id: string,
): Promise<CacheRow | null> {
  const entry = await client.query(
    `SELECT e.key FROM arkvory_derived_cache_entries e
     JOIN arkvory_derived_cache_generations g ON g.module_id=e.module_id AND g.key=e.key
     WHERE g.id=$2 AND e.module_id=$1 FOR UPDATE OF e`,
    [moduleId, id],
  );
  if (!entry.rowCount) return null;
  const result = await client.query<CacheRow>(
    `SELECT id,owner_id AS owner,state,key,manifest_hash,io_quiescent
     FROM arkvory_derived_cache_generations WHERE module_id=$1 AND id=$2 FOR UPDATE`,
    [moduleId, id],
  );
  return result.rows[0] ?? null;
}

/** Explicit operator assertion is necessary even when the session lock has disappeared.
 * A fresh connection is essential: advisory locks are reentrant on their owning session. */
export async function recoverDerivedCacheOwner(
  pool: Pool,
  owner: string,
  options: { confirmedStopped: true },
): Promise<void> {
  const confirmed: unknown = Reflect.get(options, 'confirmedStopped');
  if (confirmed !== true) throw new ModuleServiceError('invalid_input');
  const client = await pool.connect();
  try {
    await cacheTransaction(client, async () => {
      const pin = await client.query<{ acquired: boolean }>(
        'SELECT pg_try_advisory_xact_lock($1::bigint) AS acquired',
        [cacheLock('owner', owner)],
      );
      if (!pin.rows[0]?.acquired) throw new ModuleServiceError('busy');
      await client.query(
        'UPDATE arkvory_derived_cache_owners SET quiescent=true,quiescent_at=now() WHERE id=$1',
        [owner],
      );
    });
  } catch (error) {
    client.release(true);
    throw error;
  }
  client.release();
}
