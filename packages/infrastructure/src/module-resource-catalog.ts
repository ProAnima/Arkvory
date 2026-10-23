import type { Pool } from 'pg';
import { ModuleServiceError } from '@proanima/arkvory-extension-api';
import type { ResourceCatalog, ResourceFile } from '@proanima/arkvory-extension-api';
import {
  ResourceCatalogDatabase,
  resourceKey,
  resourceKeys,
  resourceName,
  resourceObject,
} from './resource-catalog-db.js';
import { collectResources, type ResourceCleanup } from './resource-catalog-collect.js';
import { catalogReady, initializeCatalog } from './resource-catalog-rebuild.js';
import { ResourceRestoreQueue } from './resource-catalog-restore-queue.js';

interface FileRow {
  key: string;
  name: string;
  metadata: Buffer;
  sources: string[];
}

/** Durable references protect every physical generation of a logical resource. No TTL release. */
export class PostgresResourceCatalog implements ResourceCatalog {
  readonly database: ResourceCatalogDatabase;
  private readonly restoration: ResourceRestoreQueue;
  constructor(
    pool: Pool,
    moduleId: string,
    readOnly: boolean,
    private readonly cleanup: ResourceCleanup,
  ) {
    this.database = new ResourceCatalogDatabase(pool, moduleId, readOnly);
    this.restoration = new ResourceRestoreQueue(this.database);
  }

  /** Only this bound port crosses into module code: no pool, namespace or cleanup grant. */
  service(): ResourceCatalog {
    return Object.freeze({
      ready: () => this.ready(),
      restore: (file: ResourceFile) => this.restore(file),
      initialize: () => this.initialize(),
      retain: (owner: string, keys: readonly string[]) => this.retain(owner, keys),
      reserve: (owner: string, file: ResourceFile) => this.reserve(owner, file),
      publish: (owner: string, name: string) => this.publish(owner, name),
      find: (key: string) => this.find(key),
      release: (owner: string) => this.release(owner),
      collect: (graceMs: number, limit: number) => this.collect(graceMs, limit),
    });
  }

  ready(): Promise<boolean> {
    return catalogReady(this.database);
  }
  restore(file: ResourceFile): Promise<void> {
    return this.restoration.restore(file);
  }
  initialize(): Promise<void> {
    return initializeCatalog(this.database);
  }
  collect(graceMs: number, limit: number): Promise<number> {
    return collectResources(this.database, this.cleanup, graceMs, limit);
  }

  async retain(owner: string, keys: readonly string[]): Promise<void> {
    resourceKey(owner);
    const batch = resourceKeys(keys);
    await this.database.run((client) => this.database.retain(client, owner, batch));
  }

  async reserve(owner: string, file: ResourceFile): Promise<void> {
    resourceKey(owner);
    resourceObject(file);
    resourceKey(file.key);
    resourceName(file.name);
    const sources = resourceKeys(file.sources);
    if (
      sources.includes(file.key) ||
      !(file.metadata instanceof Uint8Array) ||
      file.metadata.byteLength > 8192
    )
      throw new ModuleServiceError('invalid_input');
    const metadata = Buffer.from(file.metadata);
    const key = file.key,
      name = file.name,
      m = this.database.moduleId;
    await this.database.run(async (client) => {
      await this.database.retain(client, owner, [...sources, key]);
      const missing = await client.query(
        `SELECT source FROM unnest($2::text[]) source
        WHERE NOT EXISTS(SELECT 1 FROM arkvory_module_resource_files f
        WHERE f.module_id=$1 AND f.key=source AND f.ready) LIMIT 1`,
        [m, sources],
      );
      if (missing.rowCount) throw new ModuleServiceError('unavailable', 'Resource source missing');
      const existing = await client.query<FileRow>(
        `SELECT key,name,metadata,sources
        FROM arkvory_module_resource_files WHERE module_id=$1 AND name=$2`,
        [m, name],
      );
      const previous = existing.rows[0];
      if (previous) {
        if (
          previous.key !== key ||
          !previous.metadata.equals(metadata) ||
          JSON.stringify(previous.sources) !== JSON.stringify(sources)
        )
          throw new ModuleServiceError('conflict', 'Immutable resource file changed');
        return;
      }
      await client.query(
        `INSERT INTO arkvory_module_resource_files(module_id,key,name,metadata,sources)
        VALUES($1,$2,$3,$4,$5)`,
        [m, key, name, metadata, sources],
      );
      await client.query(
        `INSERT INTO arkvory_module_resource_edges(module_id,key,source)
        SELECT $1,$2,unnest($3::text[]) ON CONFLICT DO NOTHING`,
        [m, key, sources],
      );
    });
  }

  async publish(owner: string, name: string): Promise<void> {
    resourceKey(owner);
    resourceName(name);
    const m = this.database.moduleId;
    await this.database.run(async (client) => {
      const result = await client.query(
        `UPDATE arkvory_module_resource_files f SET ready=true
        WHERE f.module_id=$1 AND f.name=$2 AND EXISTS(
          SELECT 1 FROM arkvory_module_resource_refs r
          JOIN arkvory_module_resource_owners o USING(module_id,owner)
          JOIN arkvory_module_resources k USING(module_id,key)
          WHERE r.module_id=f.module_id AND r.key=f.key AND r.owner=$3
          AND NOT o.closed AND k.state='live') RETURNING f.name`,
        [m, name, owner],
      );
      if (!result.rowCount) throw new ModuleServiceError('conflict', 'Resource owner lost');
      await client.query(
        `UPDATE arkvory_module_resources r SET canonical_name=COALESCE(r.canonical_name,$2)
        FROM arkvory_module_resource_files f WHERE r.module_id=$1 AND f.module_id=$1
        AND f.name=$2 AND r.key=f.key`,
        [m, name],
      );
    });
  }

  async find(key: string): Promise<ResourceFile | null> {
    resourceKey(key);
    return this.database.run(async (client) => {
      const result = await client.query<FileRow>(
        `SELECT f.key,f.name,f.metadata,f.sources
        FROM arkvory_module_resource_files f JOIN arkvory_module_resources r USING(module_id,key)
        WHERE f.module_id=$1 AND f.key=$2 AND f.ready AND r.state='live' AND f.name=r.canonical_name
        ORDER BY f.name LIMIT 1`,
        [this.database.moduleId, key],
      );
      const row = result.rows[0];
      return row ? { ...row, metadata: Uint8Array.from(row.metadata) } : null;
    }, false);
  }

  async release(owner: string): Promise<void> {
    resourceKey(owner);
    this.cleanup.check();
    const m = this.database.moduleId;
    await this.database.run(async (client) => {
      this.cleanup.check();
      await client.query(
        `INSERT INTO arkvory_module_resource_owners(module_id,owner,closed)
        VALUES($1,$2,true) ON CONFLICT(module_id,owner) DO UPDATE SET closed=true`,
        [m, owner],
      );
      this.cleanup.check();
    });
    // Close first, then retire bounded pages. A retry resumes the closed owner's remaining refs.
    for (let page = 0; page < 32; page++) {
      const count = await this.database.run(async (client) => {
        this.cleanup.check();
        const result = await client.query<{ count: number }>(
          `WITH released AS (
        DELETE FROM arkvory_module_resource_refs WHERE module_id=$1 AND owner=$2
        AND key IN(SELECT key FROM arkvory_module_resource_refs
          WHERE module_id=$1 AND owner=$2 ORDER BY key LIMIT 1024) RETURNING key), touched AS (
        UPDATE arkvory_module_resources r SET unclaimed_at=COALESCE(r.unclaimed_at,clock_timestamp())
        WHERE r.module_id=$1 AND r.key IN(SELECT key FROM released)
        AND NOT EXISTS(SELECT 1 FROM arkvory_module_resource_refs ref
          WHERE ref.module_id=$1 AND ref.key=r.key AND ref.owner<>$2)
        AND NOT EXISTS(SELECT 1 FROM arkvory_module_resource_edges e
          WHERE e.module_id=$1 AND e.source=r.key) RETURNING r.key)
        SELECT count(*)::integer AS count FROM released`,
          [m, owner],
        );
        this.cleanup.check();
        return result.rows[0]?.count ?? 0;
      });
      if (count < 1024) return;
    }
    throw new ModuleServiceError('busy', 'Resource release requires another bounded pass');
  }
}
