import type { Pool, PoolClient } from 'pg';
import { ModuleServiceError } from '@proanima/arkvory-extension-api';
import { requireBudget, requireKey, type CacheBudget } from './derived-cache-runtime.js';
import {
  activeOwner,
  cacheTransaction,
  counts,
  cacheUsageExact,
  lockedGeneration,
} from './derived-cache-db.js';
import {
  cacheCandidates,
  startCacheDelete,
  removeCacheMetadata,
} from './derived-cache-retention.js';
import { openCacheRead } from './derived-cache-refs.js';
export { derivedCacheUsage, recoverDerivedCacheOwner } from './derived-cache-db.js';

/** Internal metadata adapter. Parent owns owner-session monitoring and CacheQueue.
 * begin must run under the SAME module-data lock as legacy quota mutations. All byte
 * reservations stay charged until removed, including aborted and lost-owner builds. */
export class DerivedCacheCatalog {
  constructor(
    private readonly pool: Pool,
    private readonly moduleId: string,
  ) {
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(moduleId)) throw new ModuleServiceError('invalid_input');
  }

  async registerOwner(client: PoolClient, owner: string): Promise<void> {
    await client.query(
      'INSERT INTO arkvory_derived_cache_owners(id) VALUES($1) ON CONFLICT DO NOTHING',
      [owner],
    );
    const result = await client.query(
      'SELECT id FROM arkvory_derived_cache_owners WHERE id=$1 AND NOT quiescent',
      [owner],
    );
    if (!result.rowCount) throw new ModuleServiceError('unavailable');
  }

  async begin(
    client: PoolClient,
    owner: string,
    key: string,
    id: string,
    reserve: CacheBudget,
    quota: CacheBudget,
    legacy: CacheBudget,
  ): Promise<'admitted' | 'busy' | 'budget'> {
    requireKey(key);
    requireBudget(reserve);
    counts(quota);
    counts(legacy);
    return cacheTransaction(client, async () => {
      if (!(await activeOwner(client, owner))) throw new ModuleServiceError('unavailable');
      // The caller's module-data lock excludes concurrent admission, including absent keys.
      const entry = await client.query<{ building_id: string | null; fence: string }>(
        'SELECT building_id,fence::text FROM arkvory_derived_cache_entries WHERE module_id=$1 AND key=$2 FOR UPDATE',
        [this.moduleId, key],
      );
      const row = entry.rows[0];
      if (row?.building_id) return 'busy';
      const totals = await client.query<{ generations: number; builds: number }>(
        `SELECT count(*)::int AS generations,count(*) FILTER (WHERE state='building')::int AS builds
         FROM arkvory_derived_cache_generations WHERE module_id=$1`,
        [this.moduleId],
      );
      if ((totals.rows[0]?.builds ?? 0) >= 32) return 'busy';
      const usage = await cacheUsageExact(client, this.moduleId);
      if (
        (totals.rows[0]?.generations ?? 0) >= 4096 ||
        usage.bytes + BigInt(legacy.bytes) + BigInt(reserve.bytes) > BigInt(quota.bytes) ||
        usage.files + BigInt(legacy.files) + BigInt(reserve.files) > BigInt(quota.files)
      )
        return 'budget';
      await client.query(
        `INSERT INTO arkvory_derived_cache_entries(module_id,key) VALUES($1,$2)
        ON CONFLICT DO NOTHING`,
        [this.moduleId, key],
      );
      const fence = (BigInt(row?.fence ?? '0') + 1n).toString();
      await client.query(
        `INSERT INTO arkvory_derived_cache_generations
        (id,module_id,key,owner_id,fence,state,reserve_bytes,reserve_files)
        VALUES($1,$2,$3,$4,$5,'building',$6,$7)`,
        [id, this.moduleId, key, owner, fence, reserve.bytes, reserve.files],
      );
      await client.query(
        'UPDATE arkvory_derived_cache_entries SET building_id=$3,fence=$4 WHERE module_id=$1 AND key=$2',
        [this.moduleId, key, id, fence],
      );
      return 'admitted';
    });
  }

  async publish(
    client: PoolClient,
    owner: string,
    id: string,
    actual: CacheBudget,
    hash: string,
  ): Promise<boolean> {
    counts(actual);
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new ModuleServiceError('invalid_input');
    return cacheTransaction(client, async () => {
      if (!(await activeOwner(client, owner))) return false;
      const row = await lockedGeneration(client, this.moduleId, id);
      if (!row || row.owner !== owner) return false;
      if (row.manifest_hash !== null) {
        const same = await client.query(
          `SELECT id FROM arkvory_derived_cache_generations
          WHERE id=$1 AND manifest_hash=$2 AND actual_bytes=$3 AND actual_files=$4`,
          [id, hash, actual.bytes, actual.files],
        );
        return same.rowCount === 1;
      }
      const updated = await client.query(
        `UPDATE arkvory_derived_cache_generations g
        SET state='ready',manifest_hash=$4,actual_bytes=$5,actual_files=$6,
          reserve_bytes=$5,reserve_files=$6,published_at=now(),io_quiescent=true
        FROM arkvory_derived_cache_entries e WHERE g.module_id=$1 AND g.id=$2 AND g.owner_id=$3
          AND g.state='building' AND g.reserve_bytes >= $5 AND g.reserve_files >= $6
          AND e.module_id=g.module_id AND e.key=g.key AND e.building_id=g.id AND e.fence=g.fence`,
        [this.moduleId, id, owner, hash, actual.bytes, actual.files],
      );
      if (!updated.rowCount) return false;
      await client.query(
        `UPDATE arkvory_derived_cache_generations SET state='retired',retired_at=now()
        WHERE id=(SELECT current_id FROM arkvory_derived_cache_entries WHERE module_id=$1 AND key=$2)`,
        [this.moduleId, row.key],
      );
      await client.query(
        `UPDATE arkvory_derived_cache_entries SET current_id=$3,building_id=NULL,last_access=now()
        WHERE module_id=$1 AND key=$2`,
        [this.moduleId, row.key, id],
      );
      return true;
    });
  }

  /** Caller has revoked this build and drained every native operation before retiring it. */
  async retire(client: PoolClient, owner: string, id: string): Promise<boolean> {
    return cacheTransaction(client, async () => {
      const row = await lockedGeneration(client, this.moduleId, id);
      if (!row || row.owner !== owner || row.manifest_hash !== null) return false;
      if (row.state !== 'building') return row.state === 'retired';
      await client.query(
        `UPDATE arkvory_derived_cache_entries SET building_id=NULL
        WHERE module_id=$1 AND key=$2 AND building_id=$3`,
        [this.moduleId, row.key, id],
      );
      await client.query(
        `UPDATE arkvory_derived_cache_generations SET state='retired',retired_at=now(),io_quiescent=true
        WHERE module_id=$1 AND id=$2`,
        [this.moduleId, id],
      );
      return true;
    });
  }

  candidates(client: PoolClient, evict = false, limit = 100) {
    return cacheCandidates(client, this.moduleId, evict, limit);
  }
  startDelete(client: PoolClient, id: string): Promise<boolean> {
    return startCacheDelete(client, this.moduleId, id);
  }
  removed(client: PoolClient, id: string): Promise<void> {
    return removeCacheMetadata(client, this.moduleId, id);
  }
  open(client: PoolClient, owner: string, key: string, readId: string) {
    return openCacheRead(client, this.moduleId, owner, key, readId);
  }

  /** Only after OS descriptors drain; caller separately releases the original client's pin. */
  async releaseRead(readId: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM arkvory_derived_cache_read_refs r USING arkvory_derived_cache_generations g
      WHERE r.id=$1 AND r.generation_id=g.id AND g.module_id=$2`,
      [readId, this.moduleId],
    );
  }

  /** Normal shutdown only, after every read/build of this instance has drained. */
  async quiesce(owner: string, client: Pick<Pool, 'query'> = this.pool): Promise<void> {
    await client.query(
      'UPDATE arkvory_derived_cache_owners SET quiescent=true,quiescent_at=now() WHERE id=$1',
      [owner],
    );
  }

  async hasPublished(id: string): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT id FROM arkvory_derived_cache_generations
      WHERE module_id=$1 AND id=$2 AND manifest_hash IS NOT NULL`,
      [this.moduleId, id],
    );
    return result.rowCount === 1;
  }
}
