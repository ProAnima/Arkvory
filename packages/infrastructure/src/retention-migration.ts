import type { PoolClient } from 'pg';

export async function migrateRetention(client: PoolClient) {
  if ((await client.query('SELECT version FROM arkvory_migrations WHERE version=13')).rowCount)
    return;
  await client.query(`
    ALTER TABLE arkvory_uploads ADD COLUMN published_at timestamptz;
    -- Conservative baseline: pre-upgrade objects become eligible only after migration time.
    UPDATE arkvory_uploads SET published_at=now() WHERE status='available';
    CREATE FUNCTION arkvory_record_publication() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.status='available' AND OLD.status='pending' THEN NEW.published_at=clock_timestamp(); END IF;
      RETURN NEW;
    END; $$;
    CREATE TRIGGER arkvory_record_publication BEFORE UPDATE OF status ON arkvory_uploads
      FOR EACH ROW EXECUTE FUNCTION arkvory_record_publication();
    CREATE TABLE arkvory_artifact_deletions (
      artifact_id uuid PRIMARY KEY REFERENCES arkvory_uploads(id),
      actor text NOT NULL,
      deleted_at timestamptz NOT NULL DEFAULT now()
    );
    INSERT INTO arkvory_migrations(version) VALUES(13);
  `);
}
