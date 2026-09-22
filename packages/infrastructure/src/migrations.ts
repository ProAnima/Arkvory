import type { Pool } from 'pg';

export async function migrate(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(18471, 1)');
    await client.query(
      `CREATE TABLE IF NOT EXISTS depot_migrations(version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
    );
    const applied = await client.query('SELECT version FROM depot_migrations WHERE version=1');
    if (applied.rowCount === 0) {
      await client.query(`
        CREATE TABLE depot_uploads (
          id uuid PRIMARY KEY,
          repository varchar(64) NOT NULL,
          owner varchar(128) NOT NULL,
          idempotency_key varchar(128) NOT NULL,
          descriptor jsonb NOT NULL,
          size bigint NOT NULL CHECK (size >= 0 AND size <= 5368709120),
          status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','available','cancelled')),
          created_at timestamptz NOT NULL,
          UNIQUE (repository, owner, idempotency_key)
        );
        CREATE INDEX depot_available ON depot_uploads(repository, id) WHERE status='available';
        INSERT INTO depot_migrations(version) VALUES(1);
      `);
    }
    const identityMigration = await client.query(
      'SELECT version FROM depot_migrations WHERE version=2',
    );
    if (identityMigration.rowCount === 0) {
      await client.query(
        `CREATE TABLE depot_storage_identity(singleton boolean PRIMARY KEY CHECK (singleton), storage_id uuid NOT NULL); INSERT INTO depot_migrations(version) VALUES(2)`,
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
