import type { Pool, PoolClient } from 'pg';
import { ArkvoryError } from '@proanima/arkvory-domain';
import type { ArchiveTree, ArchiveTreeEntry } from '@proanima/arkvory-domain';
import type {
  TreeIndexCandidate,
  TreeIndexQueue,
  TreeIndexRead,
  TreeIndexState,
  TreeIndexStore,
} from '@proanima/arkvory-application';
import { inTransaction } from './pg-transaction.js';

/**
 * Version 45 (ADR 0083, N8), expand-only: the table of contents of published archives, part of
 * a backup. `arkvory_tree_indexes` holds one outcome per indexed upload, so a missing row means
 * "not indexed yet" and an `unavailable` row is never retried; `arkvory_tree_entries` holds the
 * file entries of a `ready` one. Upload rows are never deleted by the service (cleanup only marks
 * them reclaimed and drops their table then); the cascades keep test and restore deletions valid.
 */
export async function migrateTreeIndexes(client: PoolClient): Promise<void> {
  if ((await client.query('SELECT version FROM arkvory_migrations WHERE version=45')).rowCount)
    return;
  await client.query(`
    CREATE TABLE IF NOT EXISTS arkvory_tree_indexes (
      upload_id uuid PRIMARY KEY REFERENCES arkvory_uploads(id) ON DELETE CASCADE,
      status text NOT NULL CHECK (status IN ('ready','unavailable')),
      reason text,
      entry_count integer CHECK (entry_count >= 0),
      archive_sha256 text NOT NULL,
      built_at timestamptz NOT NULL,
      CHECK ((status = 'ready') = (entry_count IS NOT NULL AND reason IS NULL))
    );
    CREATE TABLE IF NOT EXISTS arkvory_tree_entries (
      upload_id uuid NOT NULL REFERENCES arkvory_tree_indexes(upload_id) ON DELETE CASCADE,
      ordinal integer NOT NULL CHECK (ordinal >= 0),
      path text NOT NULL,
      size bigint NOT NULL CHECK (size >= 0),
      sha256 text NOT NULL,
      method text NOT NULL,
      data_offset bigint NOT NULL CHECK (data_offset >= 0),
      data_length bigint NOT NULL CHECK (data_length >= 0),
      PRIMARY KEY (upload_id, ordinal)
    );
    INSERT INTO arkvory_migrations(version) VALUES(45);
  `);
}

/** Entries per INSERT: seven arrays of this length in one statement. */
const insertBatch = 1000;

const decimal = (value: string): number => {
  const parsed = Number(value);
  if (!/^(0|[1-9][0-9]{0,15})$/.test(value) || !Number.isSafeInteger(parsed))
    throw new ArkvoryError('unavailable', 'Stored table of contents is out of range');
  return parsed;
};

interface EntryRow {
  ordinal: number;
  path: string;
  size: string;
  sha256: string;
  method: string;
  data_offset: string;
  data_length: string;
}

/** The worker's queue and store of archive tables of contents, and the route's reader. */
export class PostgresTreeIndexes implements TreeIndexRead, TreeIndexQueue, TreeIndexStore {
  constructor(private readonly pool: Pool) {}

  async state(uploadId: string): Promise<TreeIndexState | undefined> {
    const row = (
      await this.pool.query<{ status: string; reason: string | null; entry_count: number | null }>(
        'SELECT status,reason,entry_count FROM arkvory_tree_indexes WHERE upload_id=$1',
        [uploadId],
      )
    ).rows[0];
    if (!row) return undefined;
    return {
      status: row.status === 'ready' ? 'ready' : 'unavailable',
      reason: row.reason,
      entries: row.entry_count,
    };
  }

  async entries(uploadId: string, after: number, limit: number): Promise<ArchiveTreeEntry[]> {
    const rows = await this.pool.query<EntryRow>(
      `SELECT ordinal,path,size::text AS size,sha256,method,data_offset::text AS data_offset,
      data_length::text AS data_length FROM arkvory_tree_entries
      WHERE upload_id=$1 AND ordinal>$2 ORDER BY ordinal LIMIT $3`,
      [uploadId, after, limit],
    );
    return rows.rows.map((row) => ({
      ordinal: row.ordinal,
      path: row.path,
      size: decimal(row.size),
      sha256: row.sha256,
      method: row.method,
      dataOffset: decimal(row.data_offset),
      dataLength: decimal(row.data_length),
    }));
  }

  /**
   * A scan of the published uploads: there is no index on the name, and the worker asks every
   * 30 seconds for a small batch; the anti-join skips everything indexed already.
   */
  async pending(limit: number, skip: readonly string[]): Promise<TreeIndexCandidate[]> {
    const rows = await this.pool.query<{
      id: string;
      repository: string;
      size: string;
      storage_backend: string;
    }>(
      `SELECT u.id,u.repository,u.size::text AS size,u.storage_backend FROM arkvory_uploads u
      WHERE u.status='available' AND NOT u.reclaimed AND (u.descriptor->>'name') ~* '\\.(zip|upack)$'
      AND NOT EXISTS (SELECT 1 FROM arkvory_tree_indexes t WHERE t.upload_id=u.id)
      AND u.id <> ALL($2::uuid[])
      ORDER BY u.published_at, u.id LIMIT $1`,
      [limit, skip],
    );
    return rows.rows.map((row) => ({
      id: row.id,
      repository: row.repository,
      size: decimal(row.size),
      storageBackend: row.storage_backend,
    }));
  }

  /**
   * One transaction: the outcome row first, then the entries in batches. The row is inserted
   * only for a published, unreclaimed upload and only once: a second pass that races this one
   * waits on the primary key, then inserts nothing and writes no entries.
   */
  save(uploadId: string, tree: ArchiveTree): Promise<boolean> {
    return inTransaction(this.pool, async (c) => {
      const ready = tree.status === 'ready';
      const inserted = await c.query(
        `INSERT INTO arkvory_tree_indexes(upload_id,status,reason,entry_count,archive_sha256,built_at)
        SELECT u.id,$2::text,$3::text,$4::integer,u.descriptor->>'sha256',now() FROM arkvory_uploads u
        WHERE u.id=$1 AND u.status='available' AND NOT u.reclaimed
        ON CONFLICT (upload_id) DO NOTHING`,
        [uploadId, tree.status, ready ? null : tree.reason, ready ? tree.entries.length : null],
      );
      if (inserted.rowCount !== 1) return false;
      if (ready)
        for (let start = 0; start < tree.entries.length; start += insertBatch)
          await insertEntries(c, uploadId, tree.entries.slice(start, start + insertBatch));
      return true;
    });
  }
}

async function insertEntries(
  c: PoolClient,
  uploadId: string,
  entries: readonly ArchiveTreeEntry[],
): Promise<void> {
  await c.query(
    `INSERT INTO arkvory_tree_entries(upload_id,ordinal,path,size,sha256,method,data_offset,data_length)
    SELECT $1::uuid,* FROM unnest($2::integer[],$3::text[],$4::bigint[],$5::text[],$6::text[],$7::bigint[],$8::bigint[])`,
    [
      uploadId,
      entries.map((e) => e.ordinal),
      entries.map((e) => e.path),
      entries.map((e) => String(e.size)),
      entries.map((e) => e.sha256),
      entries.map((e) => e.method),
      entries.map((e) => String(e.dataOffset)),
      entries.map((e) => String(e.dataLength)),
    ],
  );
}
