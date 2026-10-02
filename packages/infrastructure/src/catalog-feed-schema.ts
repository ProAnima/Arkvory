import type { PoolClient } from 'pg';

export const CATALOG_FEED_MIGRATION = 27;

/**
 * Expand-only (ADR 0058): `detail` names what changed besides the artifact (asset path, stage).
 * A nullable column without a default is a catalog-only change; rows of older binaries keep NULL.
 * From this version publications and stage changes are journaled too, so the per-repository
 * journal is the complete ordered change feed that mirrors follow.
 */
export async function migrateCatalogFeed(client: PoolClient): Promise<void> {
  if (
    (
      await client.query('SELECT version FROM arkvory_migrations WHERE version=$1', [
        CATALOG_FEED_MIGRATION,
      ])
    ).rowCount
  )
    return;
  await client.query('ALTER TABLE arkvory_audit ADD COLUMN IF NOT EXISTS detail text');
  await client.query('INSERT INTO arkvory_migrations(version) VALUES($1)', [
    CATALOG_FEED_MIGRATION,
  ]);
}
