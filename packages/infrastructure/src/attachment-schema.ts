import type { PoolClient } from 'pg';

export async function migrateAttachments(client: PoolClient): Promise<void> {
  if ((await client.query('SELECT version FROM arkvory_migrations WHERE version=12')).rowCount)
    return;
  await client.query(`
    CREATE TABLE arkvory_attachment_revisions (
      artifact_id uuid NOT NULL REFERENCES arkvory_uploads(id),
      revision integer NOT NULL CHECK(revision>0),
      items jsonb NOT NULL CHECK(jsonb_typeof(items)='array' AND jsonb_array_length(items)<=32),
      actor text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(artifact_id,revision)
    );
    CREATE TABLE arkvory_attachment_targets (
      parent_id uuid NOT NULL,
      revision integer NOT NULL,
      target_id uuid NOT NULL REFERENCES arkvory_uploads(id),
      PRIMARY KEY(parent_id,revision,target_id),
      FOREIGN KEY(parent_id,revision) REFERENCES arkvory_attachment_revisions(artifact_id,revision),
      CHECK(parent_id<>target_id)
    );
    CREATE INDEX arkvory_attachment_target ON arkvory_attachment_targets(target_id);
    INSERT INTO arkvory_migrations(version) VALUES(12);
  `);
}
