import type { Pool } from 'pg';
import { ArkvoryError, parseManifest, requireId } from '@proanima/arkvory-domain';
import type { PackageListOptions, PackagePage } from '@proanima/arkvory-application';

interface PackageCursor {
  groupKey: string;
  nameKey: string;
  versionKey: string;
  versionText: string;
  artifactId: string;
}
interface PackageFilter {
  repository: string;
  group: string | undefined;
  name: string | undefined;
  options: PackageListOptions;
}
interface OrderField {
  expr: string;
  value: string;
  direction: 'ASC' | 'DESC';
}
interface PackageRow {
  artifact_id: string;
  manifest: unknown;
  group_key: string;
  name_key: string;
  version_key: string;
  version: string;
}

/** The cursor is bound to the exact query; reusing it with other filters or order is rejected. */
function readPackageCursor(encoded: string, filter: PackageFilter): PackageCursor {
  if (!/^[A-Za-z0-9_-]{1,2048}$/.test(encoded))
    throw new ArkvoryError('invalid_input', 'Invalid package cursor');
  let value: unknown;
  try {
    const data = Buffer.from(encoded, 'base64url');
    if (data.toString('base64url') !== encoded)
      throw new ArkvoryError('invalid_input', 'Invalid package cursor');
    value = JSON.parse(data.toString('utf8'));
  } catch {
    throw new ArkvoryError('invalid_input', 'Invalid package cursor');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new ArkvoryError('invalid_input', 'Invalid package cursor');
  const row: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  if (
    row['repository'] !== filter.repository ||
    row['sort'] !== filter.options.sort ||
    row['direction'] !== filter.options.direction ||
    row['filterGroup'] !== (filter.group ?? null) ||
    row['filterName'] !== (filter.name ?? null) ||
    typeof row['groupKey'] !== 'string' ||
    row['groupKey'].length > 128 ||
    typeof row['nameKey'] !== 'string' ||
    row['nameKey'].length > 128 ||
    typeof row['versionKey'] !== 'string' ||
    row['versionKey'].length > 512 ||
    typeof row['versionText'] !== 'string' ||
    row['versionText'].length > 128 ||
    typeof row['artifactId'] !== 'string'
  )
    throw new ArkvoryError('invalid_input', 'Package cursor does not match the query');
  return {
    groupKey: row['groupKey'],
    nameKey: row['nameKey'],
    versionKey: row['versionKey'],
    versionText: row['versionText'],
    artifactId: requireId(row['artifactId']),
  };
}

function encodePackageCursor(last: PackageRow, filter: PackageFilter): string {
  return Buffer.from(
    JSON.stringify({
      groupKey: last.group_key,
      nameKey: last.name_key,
      versionKey: last.version_key,
      versionText: last.version,
      artifactId: last.artifact_id,
      repository: filter.repository,
      sort: filter.options.sort,
      direction: filter.options.direction,
      filterGroup: filter.group ?? null,
      filterName: filter.name ?? null,
    }),
  ).toString('base64url');
}

/**
 * Total order of the page; the expressions match the arkvory_package_page_* indexes created by
 * migration 8, and version text plus artifact ID make every key unique for keyset paging.
 */
function orderFields(options: PackageListOptions, cursor: PackageCursor | undefined) {
  const keyDirection = options.sort === 'version' || options.direction === 'asc' ? 'ASC' : 'DESC';
  const groupField: OrderField = {
    expr: 'lower(package_group COLLATE "C") COLLATE "C"',
    value: cursor?.groupKey ?? '',
    direction: keyDirection,
  };
  const nameField: OrderField = {
    expr: 'lower(name COLLATE "C") COLLATE "C"',
    value: cursor?.nameKey ?? '',
    direction: keyDirection,
  };
  const versionField: OrderField = {
    expr: 'arkvory_semver_key(version) COLLATE "C"',
    value: cursor?.versionKey ?? '',
    direction: options.sort === 'version' && options.direction === 'asc' ? 'ASC' : 'DESC',
  };
  const idField: OrderField = {
    expr: 'artifact_id::text COLLATE "C"',
    value: cursor?.artifactId ?? '',
    direction: 'ASC',
  };
  const versionTextField: OrderField = {
    expr: 'version COLLATE "C"',
    value: cursor?.versionText ?? '',
    direction: 'ASC',
  };
  if (options.sort === 'name')
    return [nameField, groupField, versionField, versionTextField, idField];
  if (options.sort === 'version')
    return [versionField, groupField, nameField, versionTextField, idField];
  return [groupField, nameField, versionField, versionTextField, idField];
}

/** Lexicographic "after cursor" predicate; field values are bound as $4.. in field order. */
function seekClause(fields: readonly OrderField[]): string {
  return (
    ' AND (' +
    fields
      .map((field, index) => {
        const equal = fields
          .slice(0, index)
          .map((earlier, before) => `${earlier.expr}=$${String(4 + before)}`)
          .join(' AND ');
        const comparison = `${field.expr}${field.direction === 'ASC' ? '>' : '<'}$${String(4 + index)}`;
        return `(${equal ? `${equal} AND ` : ''}${comparison})`;
      })
      .join(' OR ') +
    ')'
  );
}

export async function readPackagePage(
  pool: Pool,
  filter: PackageFilter,
  after: string | undefined,
  limit: number,
): Promise<PackagePage> {
  const cursor = after === undefined ? undefined : readPackageCursor(after, filter);
  const fields = orderFields(filter.options, cursor);
  const parameters: (string | number | null)[] = [
    filter.repository,
    filter.group ?? null,
    filter.name ?? null,
  ];
  let seek = '';
  if (cursor) {
    parameters.push(...fields.map((field) => field.value));
    seek = seekClause(fields);
  }
  parameters.push(limit + 1);
  const result = await pool.query<PackageRow>(
    `SELECT artifact_id,manifest,version,lower(package_group COLLATE "C") COLLATE "C" AS group_key,
              lower(name COLLATE "C") COLLATE "C" AS name_key,
              arkvory_semver_key(version) COLLATE "C" AS version_key
       FROM arkvory_packages WHERE repository=$1 AND EXISTS(SELECT 1 FROM arkvory_uploads u WHERE u.id=arkvory_packages.artifact_id AND u.status='available')
         AND ($2::text IS NULL OR lower(package_group COLLATE "C")=lower($2 COLLATE "C"))
         AND ($3::text IS NULL OR lower(name COLLATE "C")=lower($3 COLLATE "C"))${seek}
       ORDER BY ${fields.map((field) => `${field.expr} ${field.direction}`).join(',')}
       LIMIT $${String(parameters.length)}`,
    parameters,
  );
  const rows = result.rows.slice(0, limit);
  const items = rows.map((row) => {
    const manifest = parseManifest(row.manifest);
    return {
      group: manifest.group,
      name: manifest.name,
      version: manifest.version,
      artifactId: row.artifact_id,
      manifest: manifest.original,
    };
  });
  const last = rows.at(-1);
  const next = result.rows.length > limit && last ? encodePackageCursor(last, filter) : null;
  return { items, next };
}
