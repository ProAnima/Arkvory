import { ModuleServiceError } from '@proanima/arkvory-extension-api';
import type { ResourceCatalogDatabase } from './resource-catalog-db.js';

export interface ResourceCleanup {
  run<T>(work: () => Promise<T>): Promise<T>;
  check(): void;
  remove(name: string): Promise<void>;
}

interface Candidate {
  key: string;
  generation: string;
  name: string | null;
}

export async function collectResources(
  db: ResourceCatalogDatabase,
  cleanup: ResourceCleanup,
  graceMs: number,
  limit: number,
): Promise<number> {
  if (
    !Number.isSafeInteger(graceMs) ||
    graceMs < 0 ||
    graceMs > 90 * 86400000 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 1000
  )
    throw new ModuleServiceError('invalid_input');
  if (db.readOnly) throw new ModuleServiceError('read_only');
  return cleanup.run(async () => {
    let removed = 0;
    for (let i = 0; i < limit; i++) {
      cleanup.check();
      const candidate = await choose(db, graceMs);
      if (!candidate) break;
      if (candidate.name !== null) {
        cleanup.check();
        await cleanup.remove(candidate.name);
        cleanup.check();
        removed++;
      }
      await finish(db, candidate, () => {
        cleanup.check();
      });
    }
    return removed;
  });
}

async function choose(db: ResourceCatalogDatabase, graceMs: number): Promise<Candidate | null> {
  return db.run(async (client) => {
    const m = db.moduleId;
    const result = await client.query<{ key: string; generation: string }>(
      `
      SELECT r.key,r.generation::text FROM arkvory_module_resources r
      WHERE r.module_id=$1 AND EXISTS(SELECT 1 FROM arkvory_module_resource_catalogs
        WHERE module_id=$1 AND ready)
      AND r.unclaimed_at<=clock_timestamp()-($2::double precision * interval '1 millisecond')
      AND NOT EXISTS(SELECT 1 FROM arkvory_module_resource_refs x WHERE x.module_id=$1 AND x.key=r.key)
      AND NOT EXISTS(SELECT 1 FROM arkvory_module_resource_edges x WHERE x.module_id=$1 AND x.source=r.key)
      ORDER BY r.unclaimed_at,r.key LIMIT 1`,
      [m, graceMs],
    );
    const row = result.rows[0];
    if (!row) return null;
    await client.query(
      `UPDATE arkvory_module_resources SET state='doomed'
      WHERE module_id=$1 AND key=$2`,
      [m, row.key],
    );
    const files = await client.query<{ name: string }>(
      `SELECT name FROM arkvory_module_resource_files
      WHERE module_id=$1 AND key=$2 ORDER BY name LIMIT 1`,
      [m, row.key],
    );
    return { ...row, name: files.rows[0]?.name ?? null };
  });
}

async function finish(
  db: ResourceCatalogDatabase,
  row: Candidate,
  check: () => void,
): Promise<void> {
  await db.run(async (client) => {
    check();
    const m = db.moduleId;
    const current = await client.query(
      `SELECT 1 FROM arkvory_module_resources
      WHERE module_id=$1 AND key=$2 AND generation=$3::bigint AND state='doomed'`,
      [m, row.key, row.generation],
    );
    if (!current.rowCount) return;
    if (row.name !== null)
      await client.query(
        `DELETE FROM arkvory_module_resource_files
      WHERE module_id=$1 AND key=$2 AND name=$3`,
        [m, row.key, row.name],
      );
    const remaining = await client.query(
      `SELECT 1 FROM arkvory_module_resource_files
      WHERE module_id=$1 AND key=$2 LIMIT 1`,
      [m, row.key],
    );
    if (remaining.rowCount) return;
    // Source edges survive every failed unlink and every remaining physical generation.
    await client.query(
      `WITH released AS (DELETE FROM arkvory_module_resource_edges
      WHERE module_id=$1 AND key=$2 RETURNING source)
      UPDATE arkvory_module_resources r SET unclaimed_at=COALESCE(r.unclaimed_at,clock_timestamp())
      WHERE r.module_id=$1 AND r.key IN(SELECT source FROM released)
      AND NOT EXISTS(SELECT 1 FROM arkvory_module_resource_refs x WHERE x.module_id=$1 AND x.key=r.key)
      AND NOT EXISTS(SELECT 1 FROM arkvory_module_resource_edges x
        WHERE x.module_id=$1 AND x.source=r.key AND x.key<>$2)`,
      [m, row.key],
    );
    await client.query(
      `UPDATE arkvory_module_resources
      SET state='live',generation=generation+1,unclaimed_at=NULL,canonical_name=NULL
      WHERE module_id=$1 AND key=$2 AND generation=$3::bigint`,
      [m, row.key, row.generation],
    );
    check();
  });
}
