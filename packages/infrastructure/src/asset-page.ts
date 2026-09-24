import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { DepotError, requireAssetPath } from '@proanima/depot-domain';
import { assetPrefixEnd, validateAssetPage } from '@proanima/depot-application';
import type { AssetPage, AssetPageOptions } from '@proanima/depot-application';

function scope(repository: string, prefix: string): string {
  return createHash('sha256')
    .update(JSON.stringify([repository, prefix]))
    .digest('hex');
}
function cursor(encoded: string, expectedScope: string, prefix: string): string {
  let value: unknown;
  try {
    const data = Buffer.from(encoded, 'base64url');
    if (data.toString('base64url') !== encoded) throw new Error('Noncanonical encoding');
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data));
  } catch {
    throw new DepotError('invalid_input', 'Invalid asset cursor');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new DepotError('invalid_input', 'Invalid asset cursor');
  const row: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  if (
    Object.keys(row).length !== 3 ||
    row['v'] !== 1 ||
    row['scope'] !== expectedScope ||
    typeof row['path'] !== 'string' ||
    !row['path'].startsWith(prefix) ||
    /[\uD800-\uDFFF]/u.test(row['path'])
  )
    throw new DepotError('invalid_input', 'Asset cursor does not match the query');
  return requireAssetPath(row['path']);
}
export async function readAssetPage(
  pool: Pool,
  repository: string,
  options: AssetPageOptions,
): Promise<AssetPage> {
  validateAssetPage(options);
  const queryScope = scope(repository, options.prefix);
  const after =
    options.after === undefined ? undefined : cursor(options.after, queryScope, options.prefix);
  const upper = assetPrefixEnd(options.prefix);
  const values: (string | number)[] = [repository, options.prefix];
  const where = ['repository=$1', 'path COLLATE "C">=$2'];
  if (upper !== null) {
    values.push(upper);
    where.push(`path COLLATE "C"<$${String(values.length)}`);
  }
  if (after !== undefined) {
    values.push(after);
    where.push(`path COLLATE "C">$${String(values.length)}`);
  }
  values.push(options.limit + 1);
  const result = await pool.query<{ path: string; revision: number; artifact_id: string }>(
    `SELECT path,revision,artifact_id FROM depot_assets WHERE ${where.join(' AND ')} ORDER BY path COLLATE "C" LIMIT $${String(values.length)}`,
    values,
  );
  const items = result.rows
    .slice(0, options.limit)
    .map((row) => ({ path: row.path, revision: row.revision, artifactId: row.artifact_id }));
  const last = items.at(-1);
  return {
    items,
    next:
      result.rows.length > options.limit && last
        ? Buffer.from(JSON.stringify({ v: 1, scope: queryScope, path: last.path })).toString(
            'base64url',
          )
        : null,
  };
}
