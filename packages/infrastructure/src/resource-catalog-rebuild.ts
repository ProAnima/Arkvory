import { ModuleServiceError } from '@proanima/arkvory-extension-api';
import type { ResourceFile } from '@proanima/arkvory-extension-api';
import {
  resourceKey,
  resourceKeys,
  resourceName,
  resourceObject,
  type ResourceCatalogDatabase,
} from './resource-catalog-db.js';

export async function catalogReady(db: ResourceCatalogDatabase): Promise<boolean> {
  return db.run(
    async (client) =>
      (
        await client.query<{ ready: boolean }>(
          'SELECT ready FROM arkvory_module_resource_catalogs WHERE module_id=$1',
          [db.moduleId],
        )
      ).rows[0]?.ready === true,
    false,
  );
}

/** Additive rebuild only. Missing/corrupt files must abort reconciliation, not become garbage. */
export async function restoreResource(
  db: ResourceCatalogDatabase,
  file: ResourceFile,
): Promise<void> {
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
  const key = file.key,
    name = file.name,
    metadata = Buffer.from(file.metadata);
  await db.run(async (client) => {
    const m = db.moduleId;
    const ready = await client.query<{ ready: boolean }>(
      'SELECT ready FROM arkvory_module_resource_catalogs WHERE module_id=$1',
      [m],
    );
    if (ready.rows[0]?.ready)
      throw new ModuleServiceError('conflict', 'Catalog already initialized');
    await client.query(
      `INSERT INTO arkvory_module_resources(module_id,key,unclaimed_at)
      SELECT $1,unnest($2::text[]),clock_timestamp() ON CONFLICT DO NOTHING`,
      [m, [key, ...sources]],
    );
    const previous = await client.query<{ key: string; metadata: Buffer; sources: string[] }>(
      'SELECT key,metadata,sources FROM arkvory_module_resource_files WHERE module_id=$1 AND name=$2',
      [m, name],
    );
    const row = previous.rows[0];
    if (
      row &&
      (row.key !== key ||
        !row.metadata.equals(metadata) ||
        JSON.stringify(row.sources) !== JSON.stringify(sources))
    )
      throw new ModuleServiceError('conflict', 'Resource rebuild disagreement');
    await client.query(
      `INSERT INTO arkvory_module_resource_files(module_id,key,name,metadata,sources,ready)
      VALUES($1,$2,$3,$4,$5,true) ON CONFLICT DO NOTHING`,
      [m, key, name, metadata, sources],
    );
    await client.query(
      `INSERT INTO arkvory_module_resource_edges(module_id,key,source)
      SELECT $1,$2,unnest($3::text[]) ON CONFLICT DO NOTHING`,
      [m, key, sources],
    );
    await client.query(
      `UPDATE arkvory_module_resources SET unclaimed_at=NULL
      WHERE module_id=$1 AND key=ANY($2::text[])`,
      [m, sources],
    );
    await client.query(
      `UPDATE arkvory_module_resources SET canonical_name=COALESCE(canonical_name,$3)
      WHERE module_id=$1 AND key=$2`,
      [m, key, name],
    );
  });
}

export async function initializeCatalog(db: ResourceCatalogDatabase): Promise<void> {
  await db.run(async (client) => {
    const m = db.moduleId;
    const missing = await client.query(
      `SELECT 1 FROM arkvory_module_resource_edges e
      WHERE e.module_id=$1 AND NOT EXISTS(SELECT 1 FROM arkvory_module_resource_files f
        WHERE f.module_id=$1 AND f.key=e.source AND f.ready) LIMIT 1`,
      [m],
    );
    if (missing.rowCount)
      throw new ModuleServiceError('unavailable', 'Incomplete resource reconciliation');
    await client.query(
      `INSERT INTO arkvory_module_resource_catalogs(module_id,ready) VALUES($1,true)
      ON CONFLICT(module_id) DO UPDATE SET ready=true`,
      [m],
    );
  });
}
