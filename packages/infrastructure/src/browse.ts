import { searchArtifacts } from './artifact-search.js';
import { readAsset, readAssets } from './asset-list.js';
import type { Pool, PoolClient } from 'pg';
import { ArkvoryError, parseDescriptor, parseManifest, requireId } from '@proanima/arkvory-domain';
import { lockCatalogMutation, requirePublished } from './catalog-mutation.js';
import { lockServiceAccess } from './service-authorization.js';
import { readAssetPage } from './asset-page.js';
import type { AssetPageOptions } from '@proanima/arkvory-application';
import type { PackageManifest, MutationAccess } from '@proanima/arkvory-domain';
import type {
  Annotation,
  AssetEntry,
  AssetRevision,
  AssetHistoryPage,
  BrowseStore,
  PackageEntry,
  PackagePage,
  PackageListOptions,
} from '@proanima/arkvory-application';

interface PackageCursor {
  groupKey: string;
  nameKey: string;
  versionKey: string;
  versionText: string;
  artifactId: string;
}
function readPackageCursor(
  encoded: string,
  repository: string,
  group: string | undefined,
  name: string | undefined,
  options: PackageListOptions,
): PackageCursor {
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
    row['repository'] !== repository ||
    row['sort'] !== options.sort ||
    row['direction'] !== options.direction ||
    row['filterGroup'] !== (group ?? null) ||
    row['filterName'] !== (name ?? null) ||
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

// arkvory-exception ARCH-004 -- Existing adapter or contract implementation combines related operations; freeze growth and extract cohesive responsibilities while preserving transactional and authorization invariants.
export class PostgresBrowse implements BrowseStore {
  constructor(private readonly pool: Pool) {}
  private async change<T>(
    repository: string,
    id: string,
    actor: string,
    action: string,
    work: (client: PoolClient) => Promise<T>,
    access: MutationAccess | undefined,
  ): Promise<T> {
    const client = await this.pool.connect();
    let broken = false;
    try {
      await client.query('BEGIN');
      await lockServiceAccess(client, access);
      await lockCatalogMutation(client, repository);
      await requirePublished(client, repository, id);
      const result = await work(client);
      await client.query(
        'INSERT INTO arkvory_audit(repository,artifact_id,actor,action) VALUES($1,$2,$3,$4)',
        [repository, id, actor, action],
      );
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        broken = true;
      }
      throw error;
    } finally {
      client.release(broken);
    }
  }
  async annotation(repository: string, id: string): Promise<Annotation> {
    const result = await this.pool.query<{
      revision: number | null;
      labels: unknown;
      metadata: unknown;
      collections: unknown;
      descriptor: unknown;
    }>(
      `SELECT a.revision,a.labels,a.metadata,a.collections,u.descriptor FROM arkvory_uploads u LEFT JOIN arkvory_annotations a ON a.artifact_id=u.id WHERE u.repository=$1 AND u.id=$2 AND u.status='available'`,
      [repository, id],
    );
    const row = result.rows[0];
    if (!row) throw new ArkvoryError('not_found', 'Artifact not found');
    const original = parseDescriptor(row.descriptor);
    if (row.revision === null)
      return { revision: 0, labels: original.labels, metadata: original.metadata, collections: [] };
    const fields = parseDescriptor({
      ...original,
      size: String(original.size),
      labels: row.labels,
      metadata: row.metadata,
    });
    const collections = parseDescriptor({
      ...original,
      size: String(original.size),
      labels: row.collections,
    }).labels;
    return {
      revision: row.revision,
      labels: fields.labels,
      metadata: fields.metadata,
      collections,
    };
  }
  async annotate(
    repository: string,
    id: string,
    expected: number,
    value: Omit<Annotation, 'revision'>,
    actor: string,
    access: MutationAccess | undefined,
  ) {
    return this.change(
      repository,
      id,
      actor,
      'annotations.replace',
      async (client) => {
        const result = await client.query(
          `INSERT INTO arkvory_annotations(artifact_id,revision,labels,metadata,collections) SELECT id,1,$3,$4,$5 FROM arkvory_uploads WHERE id=$1 AND repository=$2 AND status='available' AND $6::integer=0 ON CONFLICT(artifact_id) DO NOTHING`,
          [
            id,
            repository,
            JSON.stringify(value.labels),
            JSON.stringify(value.metadata),
            JSON.stringify(value.collections),
            expected,
          ],
        );
        if (expected > 0) {
          const updated = await client.query(
            'UPDATE arkvory_annotations SET revision=revision+1,labels=$3,metadata=$4,collections=$5 WHERE artifact_id=$1 AND revision=$2',
            [
              id,
              expected,
              JSON.stringify(value.labels),
              JSON.stringify(value.metadata),
              JSON.stringify(value.collections),
            ],
          );
          if (updated.rowCount !== 1)
            throw new ArkvoryError('conflict', 'Annotation revision changed');
        } else if (result.rowCount !== 1)
          throw new ArkvoryError('conflict', 'Annotation revision changed');
        return { revision: expected + 1, ...value };
      },
      access,
    );
  }
  async register(
    repository: string,
    id: string,
    manifest: PackageManifest,
    actor: string,
    access: MutationAccess | undefined,
  ): Promise<PackageEntry> {
    return this.change(
      repository,
      id,
      actor,
      'package.register',
      async (client) => {
        const result = await client.query<{ artifact_id: string }>(
          `INSERT INTO arkvory_packages(repository,package_group,name,version,artifact_id,manifest) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(repository,lower(package_group),lower(name),lower(version)) DO UPDATE SET artifact_id=arkvory_packages.artifact_id RETURNING artifact_id`,
          [
            repository,
            manifest.group,
            manifest.name,
            manifest.version,
            id,
            JSON.stringify(manifest.original),
          ],
        );
        if (result.rows[0]?.artifact_id !== id)
          throw new ArkvoryError('conflict', 'Package version is immutable');
        return {
          group: manifest.group,
          name: manifest.name,
          version: manifest.version,
          artifactId: id,
          manifest: manifest.original,
        };
      },
      access,
    );
  }
  async resolvePackage(
    repository: string,
    group: string,
    name: string,
    version: string | undefined,
  ): Promise<string | null> {
    const result = await this.pool.query<{ artifact_id: string }>(
      version === undefined
        ? `SELECT artifact_id FROM arkvory_packages WHERE repository=$1 AND EXISTS(SELECT 1 FROM arkvory_uploads u WHERE u.id=arkvory_packages.artifact_id AND u.status='available')
           AND lower(package_group COLLATE "C")=lower($2 COLLATE "C")
           AND lower(name COLLATE "C")=lower($3 COLLATE "C")
           ORDER BY arkvory_semver_key(version) COLLATE "C" DESC,
                    version COLLATE "C" ASC, artifact_id::text COLLATE "C" ASC LIMIT 1`
        : `SELECT artifact_id FROM arkvory_packages WHERE repository=$1 AND EXISTS(SELECT 1 FROM arkvory_uploads u WHERE u.id=arkvory_packages.artifact_id AND u.status='available')
           AND lower(package_group)=lower($2) AND lower(name)=lower($3)
           AND lower(version)=lower($4) LIMIT 1`,
      version === undefined ? [repository, group, name] : [repository, group, name, version],
    );
    return result.rows[0]?.artifact_id ?? null;
  }
  // arkvory-exception ARCH-005 -- Existing adapter or contract implementation combines related operations; freeze growth and extract cohesive responsibilities while preserving transactional and authorization invariants.
  async packagePage(
    repository: string,
    group: string | undefined,
    name: string | undefined,
    options: PackageListOptions,
    after: string | undefined,
    limit: number,
  ): Promise<PackagePage> {
    const cursor =
      after === undefined ? undefined : readPackageCursor(after, repository, group, name, options);
    const groupField = {
      expr: 'lower(package_group COLLATE "C") COLLATE "C"',
      value: cursor?.groupKey ?? '',
      direction: options.sort === 'version' || options.direction === 'asc' ? 'ASC' : 'DESC',
    } as const;
    const nameField = {
      expr: 'lower(name COLLATE "C") COLLATE "C"',
      value: cursor?.nameKey ?? '',
      direction: options.sort === 'version' || options.direction === 'asc' ? 'ASC' : 'DESC',
    } as const;
    const versionField = {
      expr: 'arkvory_semver_key(version) COLLATE "C"',
      value: cursor?.versionKey ?? '',
      direction: options.sort === 'version' && options.direction === 'asc' ? 'ASC' : 'DESC',
    } as const;
    const idField = {
      expr: 'artifact_id::text COLLATE "C"',
      value: cursor?.artifactId ?? '',
      direction: 'ASC',
    } as const;
    const versionTextField = {
      expr: 'version COLLATE "C"',
      value: cursor?.versionText ?? '',
      direction: 'ASC',
    } as const;
    const fields =
      options.sort === 'name'
        ? [nameField, groupField, versionField, versionTextField, idField]
        : options.sort === 'version'
          ? [versionField, groupField, nameField, versionTextField, idField]
          : [groupField, nameField, versionField, versionTextField, idField];
    const parameters: (string | number | null)[] = [repository, group ?? null, name ?? null];
    let seek = '';
    if (cursor) {
      parameters.push(...fields.map((field) => field.value));
      seek =
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
        ')';
    }
    parameters.push(limit + 1);
    const result = await this.pool.query<{
      artifact_id: string;
      manifest: unknown;
      group_key: string;
      name_key: string;
      version_key: string;
      version: string;
    }>(
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
    const next =
      result.rows.length > limit && last
        ? Buffer.from(
            JSON.stringify({
              groupKey: last.group_key,
              nameKey: last.name_key,
              versionKey: last.version_key,
              versionText: last.version,
              artifactId: last.artifact_id,
              repository,
              sort: options.sort,
              direction: options.direction,
              filterGroup: group ?? null,
              filterName: name ?? null,
            }),
          ).toString('base64url')
        : null;
    return { items, next };
  }
  asset(repository: string, path: string): Promise<AssetEntry> {
    return readAsset(this.pool, repository, path);
  }
  assets(repository: string, prefix: string): Promise<readonly AssetEntry[]> {
    return readAssets(this.pool, repository, prefix);
  }
  assetPage(repository: string, options: AssetPageOptions) {
    return readAssetPage(this.pool, repository, options);
  }
  async assetRevision(repository: string, path: string, revision: number): Promise<AssetRevision> {
    const result = await this.pool.query<AssetRevisionRow>(
      'SELECT path,revision,artifact_id,actor,created_at,source_revision FROM arkvory_asset_revisions WHERE repository=$1 AND path=$2 AND revision=$3',
      [repository, path, revision],
    );
    const row = result.rows[0];
    if (!row) throw new ArkvoryError('not_found', 'Asset revision not found');
    return assetRevision(row);
  }
  async assetHistory(repository: string, path: string, before?: number): Promise<AssetHistoryPage> {
    await this.asset(repository, path);
    const result = await this.pool.query<AssetRevisionRow>(
      'SELECT path,revision,artifact_id,actor,created_at,source_revision FROM arkvory_asset_revisions WHERE repository=$1 AND path=$2 AND ($3::integer IS NULL OR revision<$3) ORDER BY revision DESC LIMIT 51',
      [repository, path, before ?? null],
    );
    const items = result.rows.slice(0, 50).map(assetRevision);
    return { items, next: result.rows.length > 50 ? (items.at(-1)?.revision ?? null) : null };
  }
  async setAsset(
    repository: string,
    path: string,
    id: string,
    expected: number,
    actor: string,
    access: MutationAccess | undefined,
    sourceRevision?: number,
  ) {
    return this.change(
      repository,
      id,
      actor,
      sourceRevision === undefined ? 'asset.replace' : 'asset.restore',
      async (client) => {
        if (sourceRevision !== undefined) {
          const source = await client.query(
            'SELECT 1 FROM arkvory_asset_revisions WHERE repository=$1 AND path=$2 AND revision=$3 AND artifact_id=$4',
            [repository, path, sourceRevision, id],
          );
          if (source.rowCount !== 1)
            throw new ArkvoryError('not_found', 'Asset revision not found');
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
      },
      access,
    );
  }
  search(...args: Parameters<BrowseStore['search']>) {
    return searchArtifacts(this.pool, ...args);
  }
  async audit(repository: string, after: string) {
    const result = await this.pool.query<{
      sequence: string;
      actor: string;
      action: string;
      artifact_id: string;
      occurred_at: Date;
    }>(
      'SELECT sequence::text,actor,action,artifact_id,occurred_at FROM arkvory_audit WHERE repository=$1 AND sequence>$2::bigint ORDER BY sequence LIMIT 100',
      [repository, after],
    );
    return result.rows.map((row) => ({
      sequence: row.sequence,
      actor: row.actor,
      action: row.action,
      artifactId: row.artifact_id,
      occurredAt: row.occurred_at.toISOString(),
    }));
  }
  async reference(
    repository: string,
    id: string,
    owner: string,
    access: MutationAccess | undefined,
    key: string,
    remove: boolean,
  ) {
    await this.change(
      repository,
      id,
      owner,
      remove ? 'reference.remove' : 'reference.add',
      async (client) => {
        if (remove)
          await client.query(
            'DELETE FROM arkvory_references WHERE repository=$1 AND artifact_id=$2 AND owner=$3 AND reference=$4',
            [repository, id, owner, key],
          );
        else
          await client.query(
            'INSERT INTO arkvory_references(repository,artifact_id,owner,reference) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
            [repository, id, owner, key],
          );
      },
      access,
    );
  }
}
