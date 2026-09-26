import type { PoolClient } from 'pg';
export async function migrateStoragePolicy(client: PoolClient) {
  if ((await client.query('SELECT version FROM arkvory_migrations WHERE version=15')).rowCount)
    return;
  await client.query(`
    CREATE TABLE arkvory_storage_policies (
      repository text PRIMARY KEY,
      revision integer NOT NULL CHECK(revision>0),
      policy jsonb NOT NULL,
      authorizer_key_id uuid NOT NULL REFERENCES arkvory_api_keys(id),
      next_run_at timestamptz NOT NULL DEFAULT now(),
      last_run_at timestamptz,
      last_deleted integer NOT NULL DEFAULT 0,
      last_error text,
      capacity_checked_at timestamptz NOT NULL DEFAULT '1970-01-01',
      capacity_state text
    );
    CREATE INDEX arkvory_storage_policy_due ON arkvory_storage_policies(next_run_at,repository);
    CREATE TABLE arkvory_storage_events (
      sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      repository text NOT NULL,
      occurred_at timestamptz NOT NULL DEFAULT now(),
      level text NOT NULL CHECK(level IN ('info','warning','error')),
      code text NOT NULL,
      details jsonb NOT NULL
    );
    CREATE INDEX arkvory_storage_event_page ON arkvory_storage_events(repository,sequence);
    INSERT INTO arkvory_migrations(version) VALUES(15);
  `);
}
