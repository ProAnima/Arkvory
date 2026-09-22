import type { Pool, PoolClient } from 'pg';
import {
  DepotError,
  parseDescriptor,
  parseManifest,
  compareVersions,
} from '@proanima/depot-domain';
import type { PackageManifest } from '@proanima/depot-domain';
import type {
  Annotation,
  AssetEntry,
  BrowseStore,
  PackageEntry,
} from '@proanima/depot-application';

export class PostgresBrowse implements BrowseStore {
  constructor(private readonly pool: Pool) {}
  private async change<T>(
    repository: string,
    id: string,
    actor: string,
    action: string,
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    let broken = false;
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query(
        'INSERT INTO depot_audit(repository,artifact_id,actor,action) VALUES($1,$2,$3,$4)',
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
      `SELECT a.revision,a.labels,a.metadata,a.collections,u.descriptor FROM depot_uploads u LEFT JOIN depot_annotations a ON a.artifact_id=u.id WHERE u.repository=$1 AND u.id=$2 AND u.status='available'`,
      [repository, id],
    );
    const row = result.rows[0];
    if (!row) throw new DepotError('not_found', 'Artifact not found');
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
  ) {
    return this.change(repository, id, actor, 'annotations.replace', async (client) => {
      const result = await client.query(
        `INSERT INTO depot_annotations(artifact_id,revision,labels,metadata,collections) SELECT id,1,$3,$4,$5 FROM depot_uploads WHERE id=$1 AND repository=$2 AND status='available' AND $6::integer=0 ON CONFLICT(artifact_id) DO NOTHING`,
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
          'UPDATE depot_annotations SET revision=revision+1,labels=$3,metadata=$4,collections=$5 WHERE artifact_id=$1 AND revision=$2',
          [
            id,
            expected,
            JSON.stringify(value.labels),
            JSON.stringify(value.metadata),
            JSON.stringify(value.collections),
          ],
        );
        if (updated.rowCount !== 1) throw new DepotError('conflict', 'Annotation revision changed');
      } else if (result.rowCount !== 1)
        throw new DepotError('conflict', 'Annotation revision changed');
      return { revision: expected + 1, ...value };
    });
  }
  async register(
    repository: string,
    id: string,
    manifest: PackageManifest,
    actor: string,
  ): Promise<PackageEntry> {
    return this.change(repository, id, actor, 'package.register', async (client) => {
      const result = await client.query<{ artifact_id: string }>(
        `INSERT INTO depot_packages(repository,package_group,name,version,artifact_id,manifest) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(repository,lower(package_group),lower(name),lower(version)) DO UPDATE SET artifact_id=depot_packages.artifact_id RETURNING artifact_id`,
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
        throw new DepotError('conflict', 'Package version is immutable');
      return {
        group: manifest.group,
        name: manifest.name,
        version: manifest.version,
        artifactId: id,
        manifest: manifest.original,
      };
    });
  }
  async packages(
    repository: string,
    group: string | undefined,
    name: string | undefined,
  ): Promise<readonly PackageEntry[]> {
    const result = await this.pool.query<{ artifact_id: string; manifest: unknown }>(
      `SELECT artifact_id,manifest FROM depot_packages WHERE repository=$1 AND ($2::text IS NULL OR lower(package_group)=lower($2)) AND ($3::text IS NULL OR lower(name)=lower($3)) ORDER BY package_group,name,version LIMIT 1001`,
      [repository, group ?? null, name ?? null],
    );
    if (result.rows.length > 1000)
      throw new DepotError('invalid_input', 'Narrow the package filter (maximum 1000 results)');
    return result.rows
      .map((row) => {
        const value = parseManifest(row.manifest);
        return {
          group: value.group,
          name: value.name,
          version: value.version,
          artifactId: row.artifact_id,
          manifest: value.original,
        };
      })
      .sort(
        (a, b) =>
          a.group.localeCompare(b.group) ||
          a.name.localeCompare(b.name) ||
          compareVersions(b.version, a.version),
      );
  }
  async asset(repository: string, path: string): Promise<AssetEntry> {
    const result = await this.pool.query<{ path: string; revision: number; artifact_id: string }>(
      'SELECT * FROM depot_assets WHERE repository=$1 AND path=$2',
      [repository, path],
    );
    const row = result.rows[0];
    if (!row) throw new DepotError('not_found', 'Asset not found');
    return { path: row.path, revision: row.revision, artifactId: row.artifact_id };
  }
  async assets(repository: string, prefix: string): Promise<readonly AssetEntry[]> {
    const result = await this.pool.query<{ path: string; revision: number; artifact_id: string }>(
      'SELECT * FROM depot_assets WHERE repository=$1 AND starts_with(path,$2) ORDER BY path LIMIT 1001',
      [repository, prefix],
    );
    if (result.rows.length > 1000)
      throw new DepotError('invalid_input', 'Narrow the asset prefix (maximum 1000 results)');
    return result.rows.map((row) => ({
      path: row.path,
      revision: row.revision,
      artifactId: row.artifact_id,
    }));
  }
  async setAsset(repository: string, path: string, id: string, expected: number, actor: string) {
    return this.change(repository, id, actor, 'asset.replace', async (client) => {
      const result =
        expected === 0
          ? await client.query(
              'INSERT INTO depot_assets(repository,path,revision,artifact_id) VALUES($1,$2,1,$3) ON CONFLICT DO NOTHING',
              [repository, path, id],
            )
          : await client.query(
              'UPDATE depot_assets SET revision=revision+1,artifact_id=$3 WHERE repository=$1 AND path=$2 AND revision=$4',
              [repository, path, id, expected],
            );
      if (result.rowCount !== 1) throw new DepotError('conflict', 'Asset revision changed');
      await client.query(
        'INSERT INTO depot_asset_revisions(repository,path,revision,artifact_id) VALUES($1,$2,$3,$4)',
        [repository, path, expected + 1, id],
      );
      return { path, revision: expected + 1, artifactId: id };
    });
  }
  async search(
    repository: string,
    query: string,
    label: string,
    collection: string,
    after: string | undefined,
  ) {
    const result = await this.pool.query<{ id: string; name: string }>(
      `SELECT u.id,u.descriptor->>'name' AS name FROM depot_uploads u LEFT JOIN depot_annotations a ON a.artifact_id=u.id WHERE u.repository=$1 AND u.status='available' AND ($2::uuid IS NULL OR u.id>$2) AND strpos(lower(u.descriptor->>'name'),lower($3))>0 AND ($4='' OR COALESCE(a.labels,u.descriptor->'labels') ? $4) AND ($5='' OR a.collections ? $5) ORDER BY u.id LIMIT 100`,
      [repository, after ?? null, query, label, collection],
    );
    return result.rows;
  }
  async audit(repository: string, after: string) {
    const result = await this.pool.query<{
      sequence: string;
      actor: string;
      action: string;
      artifact_id: string;
      occurred_at: Date;
    }>(
      'SELECT sequence::text,actor,action,artifact_id,occurred_at FROM depot_audit WHERE repository=$1 AND sequence>$2::bigint ORDER BY sequence LIMIT 100',
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
  async reference(repository: string, id: string, owner: string, key: string, remove: boolean) {
    await this.change(
      repository,
      id,
      owner,
      remove ? 'reference.remove' : 'reference.add',
      async (client) => {
        if (remove)
          await client.query(
            'DELETE FROM depot_references WHERE repository=$1 AND artifact_id=$2 AND owner=$3 AND reference=$4',
            [repository, id, owner, key],
          );
        else
          await client.query(
            'INSERT INTO depot_references(repository,artifact_id,owner,reference) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
            [repository, id, owner, key],
          );
      },
    );
  }
}
