import { migrateBaseSchema } from './base-migrations.js';
import { migrateStorageSchemas } from './storage-migrations.js';
import { migrateAttachments } from './attachment-schema.js';
import { migrateRetention } from './retention-migration.js';
import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import { migrateServices } from './service-schema.js';
import { migrateDelegations } from './delegation-schema.js';
import { SCHEMA_VERSION } from './schema-version.js';

const packagePageIndexes = [
  {
    name: 'arkvory_package_page_group_asc',
    order:
      '(lower(package_group COLLATE "C") COLLATE "C") ASC, (lower(name COLLATE "C") COLLATE "C") ASC, (arkvory_semver_key(version) COLLATE "C") DESC',
  },
  {
    name: 'arkvory_package_page_group_desc',
    order:
      '(lower(package_group COLLATE "C") COLLATE "C") DESC, (lower(name COLLATE "C") COLLATE "C") DESC, (arkvory_semver_key(version) COLLATE "C") DESC',
  },
  {
    name: 'arkvory_package_page_name_asc',
    order:
      '(lower(name COLLATE "C") COLLATE "C") ASC, (lower(package_group COLLATE "C") COLLATE "C") ASC, (arkvory_semver_key(version) COLLATE "C") DESC',
  },
  {
    name: 'arkvory_package_page_name_desc',
    order:
      '(lower(name COLLATE "C") COLLATE "C") DESC, (lower(package_group COLLATE "C") COLLATE "C") DESC, (arkvory_semver_key(version) COLLATE "C") DESC',
  },
  {
    name: 'arkvory_package_page_version_asc',
    order:
      '(arkvory_semver_key(version) COLLATE "C") ASC, (lower(package_group COLLATE "C") COLLATE "C") ASC, (lower(name COLLATE "C") COLLATE "C") ASC',
  },
  {
    name: 'arkvory_package_page_version_desc',
    order:
      '(arkvory_semver_key(version) COLLATE "C") DESC, (lower(package_group COLLATE "C") COLLATE "C") ASC, (lower(name COLLATE "C") COLLATE "C") ASC',
  },
] as const;

const catalogIndexMigrations = [
  {
    version: 17,
    indexes: [
      {
        name: 'arkvory_online_cleanup_candidates',
        definition:
          "ON arkvory_uploads(repository,gc_checked_at,id) WHERE NOT reclaimed AND (status<>'available' OR NOT temp_cleaned)",
      },
      {
        name: 'arkvory_online_cleanup_due',
        definition:
          "ON arkvory_cleanup_settings(next_run_at,repository) WHERE policy->>'enabled'='true'",
      },
    ],
  },
  {
    version: 14,
    indexes: [
      {
        name: 'arkvory_asset_history_artifact',
        definition: 'ON arkvory_asset_revisions(artifact_id)',
      },
      { name: 'arkvory_asset_current_artifact', definition: 'ON arkvory_assets(artifact_id)' },
    ],
  },
  {
    version: 8,
    indexes: packagePageIndexes.map((index) => ({
      name: index.name,
      definition: `ON arkvory_packages (repository, ${index.order}, (version COLLATE "C") ASC, ((artifact_id::text) COLLATE "C") ASC)`,
    })),
  },
  {
    version: 11,
    indexes: [
      {
        name: 'arkvory_asset_page_path',
        definition: 'ON arkvory_assets (repository, path COLLATE "C")',
      },
    ],
  },
] as const;

async function migrateCatalogIndexes(pool: Pool, upTo: number): Promise<void> {
  // Index builds can exceed the short request timeout on the runtime catalog pool.
  const migrationPool = new Pool({
    ...pool.options,
    max: 1,
    statement_timeout: 10 * 60 * 1000,
    query_timeout: 11 * 60 * 1000,
  });
  let client: PoolClient | undefined;
  let unusable = false;
  let locked = false;
  try {
    client = await migrationPool.connect();
    const deadline = Date.now() + 10 * 60 * 1000;
    let delay = 100;
    for (;;) {
      const attempt = await client.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock(18471, 9) AS locked',
      );
      locked = attempt.rows[0]?.locked === true;
      if (locked) break;
      if (Date.now() >= deadline) throw new Error('Timed out waiting for catalog index migration');
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, 1000);
    }
    for (const migration of catalogIndexMigrations) {
      if (migration.version > upTo) continue;
      const applied = await client.query(
        'SELECT version FROM arkvory_migrations WHERE version=$1',
        [migration.version],
      );
      if (applied.rowCount !== 0) continue;
      for (const index of migration.indexes) {
        const state = await client.query<{ indisvalid: boolean }>(
          'SELECT indisvalid FROM pg_index WHERE indexrelid=to_regclass($1::text)',
          [index.name],
        );
        if (state.rows[0]?.indisvalid === true) continue;
        if (state.rowCount !== 0) await client.query(`DROP INDEX CONCURRENTLY ${index.name}`);
        await client.query(`CREATE INDEX CONCURRENTLY ${index.name} ${index.definition}`);
      }
      await client.query('INSERT INTO arkvory_migrations(version) VALUES($1)', [migration.version]);
    }
  } catch (error) {
    unusable = true;
    throw error;
  } finally {
    if (client && locked && !unusable) {
      try {
        await client.query('SELECT pg_advisory_unlock(18471, 9)');
      } catch {
        unusable = true;
      }
    }
    client?.release(unusable);
    await migrationPool.end();
  }
}

/** Highest recorded migration, 0 for an empty database; read-only and safe before migrate(). */
export async function appliedSchemaVersion(pool: Pool): Promise<number> {
  // Two statements: a subquery on a missing table fails at analysis even in an untaken branch.
  const present = await pool.query<{ present: boolean }>(
    "SELECT to_regclass('arkvory_migrations') IS NOT NULL AS present",
  );
  if (present.rows[0]?.present !== true) return 0;
  const result = await pool.query<{ version: number | null }>(
    'SELECT max(version) AS version FROM arkvory_migrations',
  );
  return result.rows[0]?.version ?? 0;
}

/** Groups of versions 9-13 in their historical order between the base and storage schemas. */
const serviceSteps: readonly (readonly [number, (client: PoolClient) => Promise<void>])[] = [
  [9, migrateServices],
  [10, migrateDelegations],
  [12, migrateAttachments],
  [13, migrateRetention],
];

export interface MigrateOptions {
  /**
   * Highest version to apply, for a data-only restore into the schema of an older backup.
   * Steps keep their historical order; every step only depends on lower versions, so a bounded
   * run followed by an unbounded one reaches the same schema as a fresh migration.
   */
  readonly upTo?: number;
}

/**
 * Applies schema versions in one transaction under advisory lock 18471/1, then builds the
 * online catalog indexes outside it (CREATE INDEX CONCURRENTLY cannot run in a transaction).
 * Every step is skipped when its version is recorded, so repeated and concurrent runs are safe.
 */
export async function migrate(pool: Pool, options: MigrateOptions = {}): Promise<void> {
  const upTo = options.upTo ?? SCHEMA_VERSION;
  if (!Number.isSafeInteger(upTo) || upTo < 1 || upTo > SCHEMA_VERSION)
    throw new Error('Migration bound is outside the versions of this release');
  const client = await pool.connect();
  let unusable = false;
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(18471, 1)');
    await client.query(
      `CREATE TABLE IF NOT EXISTS arkvory_migrations(version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
    );
    await migrateBaseSchema(client, upTo);
    for (const [version, step] of serviceSteps) if (version <= upTo) await step(client);
    await migrateStorageSchemas(client, upTo);
    await client.query('COMMIT');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      unusable = true;
    }
    throw error;
  } finally {
    client.release(unusable);
  }
  await migrateCatalogIndexes(pool, upTo);
}
