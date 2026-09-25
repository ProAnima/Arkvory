import type { PoolClient } from 'pg';

export async function migrateCleanup(client: PoolClient) {
  if ((await client.query('SELECT version FROM depot_migrations WHERE version=16')).rowCount)
    return;
  await client.query(`
    ALTER TABLE depot_uploads ADD COLUMN temp_cleaned boolean NOT NULL DEFAULT false;
    ALTER TABLE depot_uploads ADD COLUMN gc_checked_at timestamptz NOT NULL DEFAULT '1970-01-01';
    CREATE TABLE depot_cleanup_settings (
      repository text PRIMARY KEY, revision integer NOT NULL CHECK(revision>0), policy jsonb NOT NULL,
      next_run_at timestamptz NOT NULL DEFAULT now(), last_run_at timestamptz,
      last_collected integer NOT NULL DEFAULT 0, last_deferred integer NOT NULL DEFAULT 0,
      last_failed integer NOT NULL DEFAULT 0, last_reclaimed_bytes bigint NOT NULL DEFAULT 0,
      last_error text
    );
    INSERT INTO depot_migrations(version) VALUES(16);
  `);
}
