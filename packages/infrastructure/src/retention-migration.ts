import type { PoolClient } from 'pg';

export async function migrateRetention(client: PoolClient) {
  if ((await client.query('SELECT version FROM depot_migrations WHERE version=13')).rowCount)
    return;
  await client.query(`
    ALTER TABLE depot_uploads ADD COLUMN published_at timestamptz;
    -- Conservative baseline: pre-upgrade objects become eligible only after migration time.
    UPDATE depot_uploads SET published_at=now() WHERE status='available';
    CREATE FUNCTION depot_record_publication() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.status='available' AND OLD.status='pending' THEN NEW.published_at=clock_timestamp(); END IF;
      RETURN NEW;
    END; $$;
    CREATE TRIGGER depot_record_publication BEFORE UPDATE OF status ON depot_uploads
      FOR EACH ROW EXECUTE FUNCTION depot_record_publication();
    CREATE TABLE depot_artifact_deletions (
      artifact_id uuid PRIMARY KEY REFERENCES depot_uploads(id),
      actor text NOT NULL,
      deleted_at timestamptz NOT NULL DEFAULT now()
    );
    INSERT INTO depot_migrations(version) VALUES(13);
  `);
}
