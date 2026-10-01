import type { PoolClient } from 'pg';

export const REQUEST_CORRELATION_MIGRATION = 24;

/**
 * Expand-only: nullable columns without defaults are catalog-only changes (no table rewrite and
 * no long lock), and binaries without this migration never read or write them. Rows written
 * before the migration, by an older binary or by a process without a request keep NULL.
 */
export async function migrateRequestCorrelation(client: PoolClient): Promise<void> {
  if (
    (
      await client.query('SELECT version FROM arkvory_migrations WHERE version=$1', [
        REQUEST_CORRELATION_MIGRATION,
      ])
    ).rowCount
  )
    return;
  await client.query(`
    ALTER TABLE arkvory_jobs ADD COLUMN IF NOT EXISTS request_id varchar(128);
    ALTER TABLE arkvory_security_audit ADD COLUMN IF NOT EXISTS request_id varchar(128);
    ALTER TABLE arkvory_audit ADD COLUMN IF NOT EXISTS request_id varchar(128);
  `);
  await client.query('INSERT INTO arkvory_migrations(version) VALUES($1)', [
    REQUEST_CORRELATION_MIGRATION,
  ]);
}
