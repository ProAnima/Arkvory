import type { Pool } from 'pg';
import { lfsObjectAction } from '@proanima/arkvory-domain';
import type { Principal } from '@proanima/arkvory-domain';
import type { LfsIndex, LfsLock, LfsLocks } from '@proanima/arkvory-application';
import { inTransaction } from './pg-transaction.js';
import { lockCatalogMutation } from './catalog-mutation.js';
import { appendCatalogAudit } from './catalog-audit.js';
import { storedCorrelation } from './request-correlation.js';

/**
 * LFS object rows in PostgreSQL. A change takes the repository's catalog lock and journals
 * itself in the same transaction, like the registry index (ADR 0063): mirrors follow the feed
 * in commit order, and retention, which deletes under that lock, sees the row committed.
 */
export class PostgresLfsIndex implements LfsIndex {
  constructor(private readonly pool: Pool) {}

  async object(repository: string, oid: string): Promise<string | null> {
    const result = await this.pool.query<{ artifact_id: string }>(
      'SELECT artifact_id::text FROM arkvory_lfs_objects WHERE repository=$1 AND oid=$2',
      [repository, oid],
    );
    return result.rows[0]?.artifact_id ?? null;
  }

  async addObject(
    actor: Principal,
    repository: string,
    oid: string,
    artifactId: string,
  ): Promise<void> {
    await inTransaction(this.pool, async (client) => {
      await lockCatalogMutation(client, repository);
      await client.query(
        `INSERT INTO arkvory_lfs_objects(repository,oid,artifact_id) VALUES($1,$2,$3)
         ON CONFLICT (repository,oid) DO UPDATE SET artifact_id=EXCLUDED.artifact_id`,
        [repository, oid, artifactId],
      );
      await appendCatalogAudit(
        client,
        [{ repository, artifactId, actor: actor.id, action: lfsObjectAction, detail: oid }],
        storedCorrelation(actor.requestId),
      );
    });
  }
}

interface LockRow {
  id: string;
  path: string;
  owner_id: string;
  owner_name: string;
  locked_at: Date;
}
const lockOf = (row: LockRow): LfsLock => ({
  id: row.id,
  path: row.path,
  ownerId: row.owner_id,
  ownerName: row.owner_name,
  lockedAt: row.locked_at.toISOString(),
});
const columns = 'id::text, path, owner_id, owner_name, locked_at';

/** File locks of the repositories; one per path, ordered by path for stable pages. */
export class PostgresLfsLocks implements LfsLocks {
  constructor(private readonly pool: Pool) {}

  async create(lock: {
    readonly id: string;
    readonly repository: string;
    readonly path: string;
    readonly ownerId: string;
  }): Promise<{ readonly created: boolean; readonly lock: LfsLock }> {
    // The name people see in `git lfs locks`: the user's or service account's, else the key ID.
    const inserted = await this.pool.query<LockRow>(
      `INSERT INTO arkvory_lfs_locks(id,repository,path,owner_id,owner_name)
       VALUES($1,$2,$3,$4,COALESCE(
         (SELECT name FROM arkvory_users WHERE 'user:'||id::text=$4),
         (SELECT name FROM arkvory_service_accounts WHERE 'service:'||id::text=$4),
         $4))
       ON CONFLICT (repository,path) DO NOTHING RETURNING ${columns}`,
      [lock.id, lock.repository, lock.path, lock.ownerId],
    );
    const row = inserted.rows[0];
    if (row) return { created: true, lock: lockOf(row) };
    const held = await this.pool.query<LockRow>(
      `SELECT ${columns} FROM arkvory_lfs_locks WHERE repository=$1 AND path=$2`,
      [lock.repository, lock.path],
    );
    const existing = held.rows[0];
    // Released between the two statements: the caller may simply try again.
    if (!existing) return this.create(lock);
    return { created: false, lock: lockOf(existing) };
  }

  async list(
    repository: string,
    filter: { readonly path?: string; readonly id?: string },
    after: string | null,
    limit: number,
  ): Promise<{ readonly locks: readonly LfsLock[]; readonly next: string | null }> {
    const id = filter.id !== undefined && /^[0-9a-f-]{36}$/.test(filter.id) ? filter.id : null;
    if (filter.id !== undefined && id === null) return { locks: [], next: null };
    const result = await this.pool.query<LockRow>(
      `SELECT ${columns} FROM arkvory_lfs_locks
       WHERE repository=$1 AND ($2::text IS NULL OR path=$2) AND ($3::uuid IS NULL OR id=$3)
         AND ($4::text IS NULL OR path > $4)
       ORDER BY path COLLATE "C" LIMIT $5`,
      [repository, filter.path ?? null, id, after, limit + 1],
    );
    const rows = result.rows.slice(0, limit);
    const last = rows.at(-1);
    return {
      locks: rows.map(lockOf),
      next: result.rows.length > limit && last ? last.path : null,
    };
  }

  async get(repository: string, id: string): Promise<LfsLock | null> {
    if (!/^[0-9a-f-]{36}$/.test(id)) return null;
    const result = await this.pool.query<LockRow>(
      `SELECT ${columns} FROM arkvory_lfs_locks WHERE repository=$1 AND id=$2`,
      [repository, id],
    );
    const row = result.rows[0];
    return row ? lockOf(row) : null;
  }

  async remove(repository: string, id: string): Promise<LfsLock | null> {
    if (!/^[0-9a-f-]{36}$/.test(id)) return null;
    const result = await this.pool.query<LockRow>(
      `DELETE FROM arkvory_lfs_locks WHERE repository=$1 AND id=$2 RETURNING ${columns}`,
      [repository, id],
    );
    const row = result.rows[0];
    return row ? lockOf(row) : null;
  }
}
