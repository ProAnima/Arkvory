import type { Pool, PoolClient } from 'pg';
import { requireId } from '@proanima/arkvory-domain';
import type { VerifyDepth } from '@proanima/arkvory-domain';
import type {
  AgentCatalog,
  AgentLease,
  BackupPage,
  BackupPageQuery,
  BackupPointCatalog,
  BackupPointRecord,
  CatalogEntry,
} from '@proanima/arkvory-application';
import { inTransaction } from './pg-transaction.js';
import { leaseLost, requireAgentLease } from './backup-agent-lease.js';
import { decodeCursor, encodeCursor } from './backup-cursor.js';

/** Upper bound of live points read at once; equals the vault listing bound. */
export const MAX_CATALOG_POINTS = 10000;

interface PointRow {
  id: string;
  vault_id: string;
  snapshot_at: Date;
  completed_at: Date;
  blobs: string;
  content_bytes: string;
  new_bytes: string;
  tables: number;
  rows: string;
  pinned: boolean;
  verified_at: Date | null;
  verify_depth: VerifyDepth | null;
  verify_error: string | null;
  deep_verified_at: Date | null;
  cursor_at: string;
}
export const pointColumns = `id::text, vault_id::text, snapshot_at, completed_at, blobs::text,
  content_bytes::text, new_bytes::text, tables, rows::text, pinned, verified_at, verify_depth,
  verify_error, deep_verified_at, (extract(epoch FROM snapshot_at) * 1000000)::bigint::text
  AS cursor_at`;

export function pointRecord(row: PointRow): BackupPointRecord {
  return {
    id: row.id,
    vaultId: row.vault_id,
    snapshotAt: row.snapshot_at.getTime(),
    completedAt: row.completed_at.getTime(),
    blobs: Number(row.blobs),
    contentBytes: row.content_bytes,
    newBytes: row.new_bytes,
    tables: row.tables,
    rows: Number(row.rows),
    pinned: row.pinned,
    verifiedAt: row.verified_at?.getTime() ?? null,
    verifyDepth: row.verify_depth,
    verifyError: row.verify_error,
    deepVerifiedAt: row.deep_verified_at?.getTime() ?? null,
  };
}

async function insert(client: PoolClient, entry: CatalogEntry, exact: boolean): Promise<void> {
  const { manifest } = entry;
  // An exact count from the capture replaces an estimate written by an earlier rebuild.
  await client.query(
    `INSERT INTO arkvory_backup_points(id, vault_id, job_id, snapshot_at, completed_at, blobs,
       content_bytes, new_bytes, tables, rows)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (id) DO ${exact ? 'UPDATE SET new_bytes=EXCLUDED.new_bytes' : 'NOTHING'}`,
    [
      manifest.pointId,
      manifest.vaultId,
      manifest.jobId,
      manifest.snapshot.takenAt,
      manifest.completedAt,
      manifest.inventory.count,
      manifest.inventory.contentBytes,
      entry.newBytes,
      manifest.tables.length,
      manifest.tables.reduce((sum, table) => sum + table.rows, 0),
    ],
  );
}

/**
 * Catalog cache of restore points (ADR 0056). The vault stays the source of truth: the agent
 * rebuilds rows from it, while pins and verification results live only here.
 */
export class PostgresBackupCatalog implements BackupPointCatalog, AgentCatalog {
  constructor(private readonly pool: Pool) {}

  async points(vaultId: string, query: BackupPageQuery): Promise<BackupPage<BackupPointRecord>> {
    const cursor = query.after === undefined ? null : decodeCursor(query.after);
    const result = await this.pool.query<PointRow>(
      `SELECT ${pointColumns} FROM arkvory_backup_points
       WHERE vault_id=$1 AND forgotten_at IS NULL AND ($2::bigint IS NULL OR
         ((extract(epoch FROM snapshot_at) * 1000000)::bigint, id) < ($2, $3::uuid))
       ORDER BY snapshot_at DESC, id DESC LIMIT $4`,
      [requireId(vaultId), cursor?.at ?? null, cursor?.id ?? null, query.limit + 1],
    );
    const rows = result.rows.slice(0, query.limit);
    const last = rows.at(-1);
    return {
      items: rows.map(pointRecord),
      next: result.rows.length > query.limit && last ? encodeCursor(last.cursor_at, last.id) : null,
    };
  }

  async point(vaultId: string, pointId: string): Promise<BackupPointRecord | null> {
    const result = await this.pool.query<PointRow>(
      `SELECT ${pointColumns} FROM arkvory_backup_points
       WHERE id=$1 AND vault_id=$2 AND forgotten_at IS NULL`,
      [requireId(pointId), requireId(vaultId)],
    );
    const row = result.rows[0];
    return row ? pointRecord(row) : null;
  }

  async pin(vaultId: string, pointId: string, pinned: boolean) {
    // Retention marks a point forgotten before it touches the vault, so a pin either lands
    // first and protects the point, or finds it already forgotten.
    const result = await this.pool.query<PointRow>(
      `UPDATE arkvory_backup_points SET pinned=$3
       WHERE id=$1 AND vault_id=$2 AND forgotten_at IS NULL RETURNING ${pointColumns}`,
      [requireId(pointId), requireId(vaultId), pinned],
    );
    const row = result.rows[0];
    return row ? pointRecord(row) : null;
  }

  async live(vaultId: string): Promise<readonly BackupPointRecord[]> {
    const result = await this.pool.query<PointRow>(
      `SELECT ${pointColumns} FROM arkvory_backup_points WHERE vault_id=$1 AND forgotten_at IS NULL
       ORDER BY snapshot_at DESC, id DESC LIMIT $2`,
      [requireId(vaultId), MAX_CATALOG_POINTS],
    );
    return result.rows.map(pointRecord);
  }

  async known(vaultId: string): Promise<ReadonlySet<string>> {
    const result = await this.pool.query<{ id: string }>(
      'SELECT id::text FROM arkvory_backup_points WHERE vault_id=$1',
      [requireId(vaultId)],
    );
    return new Set(result.rows.map((row) => row.id));
  }

  async forgotten(vaultId: string): Promise<ReadonlySet<string>> {
    const result = await this.pool.query<{ id: string }>(
      'SELECT id::text FROM arkvory_backup_points WHERE vault_id=$1 AND forgotten_at IS NOT NULL',
      [requireId(vaultId)],
    );
    return new Set(result.rows.map((row) => row.id));
  }

  async reconcile(
    lease: AgentLease,
    vaultId: string,
    change: {
      readonly added: readonly CatalogEntry[];
      readonly present: readonly string[];
      readonly damaged: readonly string[];
    },
  ): Promise<void> {
    await inTransaction(this.pool, async (client) => {
      await requireAgentLease(client, lease);
      for (const entry of change.added) await insert(client, entry, false);
      await client.query(
        `UPDATE arkvory_backup_points SET verify_error='manifest_invalid',
          verified_at=clock_timestamp(), verify_depth=COALESCE(verify_depth, 'structural')
         WHERE vault_id=$1 AND forgotten_at IS NULL AND id=ANY($2::uuid[])
         AND verify_error IS DISTINCT FROM 'manifest_invalid'`,
        [requireId(vaultId), change.damaged],
      );
      await client.query(
        `UPDATE arkvory_backup_points SET forgotten_at=clock_timestamp()
         WHERE vault_id=$1 AND forgotten_at IS NULL AND NOT (id=ANY($2::uuid[]))`,
        [requireId(vaultId), [...change.present, ...change.damaged]],
      );
    });
  }

  async record(lease: AgentLease, entry: CatalogEntry): Promise<void> {
    await inTransaction(this.pool, async (client) => {
      await requireAgentLease(client, lease);
      await insert(client, entry, true);
    });
  }

  async verified(
    lease: AgentLease,
    pointId: string,
    result: { readonly depth: VerifyDepth; readonly error: string | null },
  ): Promise<void> {
    await inTransaction(this.pool, async (client) => {
      await requireAgentLease(client, lease);
      await client.query(
        `UPDATE arkvory_backup_points SET verified_at=clock_timestamp(), verify_depth=$2::text,
          verify_error=$3::varchar, deep_verified_at=CASE WHEN $2::text='deep'
            AND $3::varchar IS NULL THEN clock_timestamp() ELSE deep_verified_at END
         WHERE id=$1`,
        [requireId(pointId), result.depth, result.error?.slice(0, 64) ?? null],
      );
    });
  }

  async forget(lease: AgentLease, vaultId: string, pointId: string): Promise<boolean> {
    return inTransaction(this.pool, async (client) => {
      await requireAgentLease(client, lease);
      const result = await client.query<{ pinned: boolean; forgotten: boolean }>(
        `UPDATE arkvory_backup_points SET forgotten_at=COALESCE(forgotten_at, clock_timestamp())
         WHERE id=$1 AND vault_id=$2 AND NOT pinned
         RETURNING pinned, forgotten_at IS NOT NULL AS forgotten`,
        [requireId(pointId), requireId(vaultId)],
      );
      if (!lease.active) throw leaseLost();
      return result.rows[0]?.forgotten === true;
    });
  }
}
