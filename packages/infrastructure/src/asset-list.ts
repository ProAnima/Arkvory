import type { Pool } from 'pg';
import { ArkvoryError } from '@proanima/arkvory-domain';
import type { AssetEntry } from '@proanima/arkvory-application';
export async function readAsset(pool: Pool, repository: string, path: string): Promise<AssetEntry> {
  const result = await pool.query<{ path: string; revision: number; artifact_id: string }>(
    'SELECT * FROM arkvory_assets WHERE repository=$1 AND path=$2',
    [repository, path],
  );
  const row = result.rows[0];
  if (!row) throw new ArkvoryError('not_found', 'Asset not found');
  return { path: row.path, revision: row.revision, artifactId: row.artifact_id };
}
export async function readAssets(
  pool: Pool,
  repository: string,
  prefix: string,
): Promise<readonly AssetEntry[]> {
  const result = await pool.query<{ path: string; revision: number; artifact_id: string }>(
    'SELECT * FROM arkvory_assets WHERE repository=$1 AND starts_with(path,$2) ORDER BY path LIMIT 1001',
    [repository, prefix],
  );
  if (result.rows.length > 1000)
    throw new ArkvoryError('invalid_input', 'Narrow the asset prefix (maximum 1000 results)');
  return result.rows.map((row) => ({
    path: row.path,
    revision: row.revision,
    artifactId: row.artifact_id,
  }));
}
