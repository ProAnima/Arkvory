import type { Pool, PoolClient } from 'pg';
import { ArkvoryError } from '@proanima/arkvory-domain';
import type { AssetEntry, AssetHistoryPage, AssetRevision } from '@proanima/arkvory-application';
import { readAsset } from './asset-list.js';

interface AssetRevisionRow {
  path: string;
  revision: number;
  artifact_id: string;
  actor: string | null;
  created_at: Date | null;
  source_revision: number | null;
}
function assetRevision(row: AssetRevisionRow): AssetRevision {
  return {
    path: row.path,
    revision: row.revision,
    artifactId: row.artifact_id,
    actor: row.actor,
    createdAt: row.created_at?.toISOString() ?? null,
    sourceRevision: row.source_revision,
  };
}

export async function readAssetRevision(
  pool: Pool,
  repository: string,
  path: string,
  revision: number,
): Promise<AssetRevision> {
  const result = await pool.query<AssetRevisionRow>(
    'SELECT path,revision,artifact_id,actor,created_at,source_revision FROM arkvory_asset_revisions WHERE repository=$1 AND path=$2 AND revision=$3',
    [repository, path, revision],
  );
  const row = result.rows[0];
  if (!row) throw new ArkvoryError('not_found', 'Asset revision not found');
  return assetRevision(row);
}

/** Newest first, 50 per page; `next` is the oldest returned revision, used as `before`. */
export async function readAssetHistory(
  pool: Pool,
  repository: string,
  path: string,
  before?: number,
): Promise<AssetHistoryPage> {
  await readAsset(pool, repository, path);
  const result = await pool.query<AssetRevisionRow>(
    'SELECT path,revision,artifact_id,actor,created_at,source_revision FROM arkvory_asset_revisions WHERE repository=$1 AND path=$2 AND ($3::integer IS NULL OR revision<$3) ORDER BY revision DESC LIMIT 51',
    [repository, path, before ?? null],
  );
  const items = result.rows.slice(0, 50).map(assetRevision);
  return { items, next: result.rows.length > 50 ? (items.at(-1)?.revision ?? null) : null };
}

/** What the asset pointer changes to; sourceRevision marks a restore of historical bytes. */
export interface AssetPointerChange {
  repository: string;
  path: string;
  id: string;
  expected: number;
  actor: string;
  sourceRevision: number | undefined;
}

/**
 * Compare-and-set of the current pointer plus its history row inside the caller's catalog
 * transaction. A restore must reference an existing revision of the same path and artifact.
 */
export async function writeAssetPointer(
  client: PoolClient,
  change: AssetPointerChange,
): Promise<AssetEntry> {
  const { repository, path, id, expected, actor, sourceRevision } = change;
  if (sourceRevision !== undefined) {
    const source = await client.query(
      'SELECT 1 FROM arkvory_asset_revisions WHERE repository=$1 AND path=$2 AND revision=$3 AND artifact_id=$4',
      [repository, path, sourceRevision, id],
    );
    if (source.rowCount !== 1) throw new ArkvoryError('not_found', 'Asset revision not found');
  }
  const result =
    expected === 0
      ? await client.query(
          'INSERT INTO arkvory_assets(repository,path,revision,artifact_id) VALUES($1,$2,1,$3) ON CONFLICT DO NOTHING',
          [repository, path, id],
        )
      : await client.query(
          'UPDATE arkvory_assets SET revision=revision+1,artifact_id=$3 WHERE repository=$1 AND path=$2 AND revision=$4',
          [repository, path, id, expected],
        );
  if (result.rowCount !== 1) throw new ArkvoryError('conflict', 'Asset revision changed');
  await client.query(
    'INSERT INTO arkvory_asset_revisions(repository,path,revision,artifact_id,actor,source_revision) VALUES($1,$2,$3,$4,$5,$6)',
    [repository, path, expected + 1, id, actor, sourceRevision ?? null],
  );
  return { path, revision: expected + 1, artifactId: id };
}
