import type { PoolClient } from 'pg';

export async function migratePromotions(client: PoolClient): Promise<void> {
  if ((await client.query('SELECT version FROM arkvory_migrations WHERE version=22')).rowCount)
    return;
  await client.query(`
    CREATE TABLE arkvory_artifact_stages (
      repository varchar(64) NOT NULL,
      artifact_id uuid NOT NULL REFERENCES arkvory_uploads(id),
      stage varchar(32) NOT NULL CHECK (stage ~ '^[a-z0-9][a-z0-9_.-]{0,31}$'),
      promoted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      actor text NOT NULL,
      comment varchar(1024),
      PRIMARY KEY (repository, artifact_id, stage)
    );
    CREATE INDEX arkvory_artifact_stages_stage
      ON arkvory_artifact_stages(repository, stage, promoted_at DESC, artifact_id);
    CREATE INDEX arkvory_artifact_stages_artifact ON arkvory_artifact_stages(artifact_id);
    CREATE TABLE arkvory_promotion_events (
      sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      repository varchar(64) NOT NULL,
      artifact_id uuid NOT NULL,
      action text NOT NULL CHECK (action IN ('stage.added','stage.removed','promoted','received')),
      stage varchar(32),
      mode text CHECK (mode IN ('copy','move')),
      peer_repository varchar(64),
      peer_artifact_id uuid,
      actor text NOT NULL,
      comment varchar(1024),
      occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE INDEX arkvory_promotion_events_repository ON arkvory_promotion_events(repository, sequence);
    CREATE INDEX arkvory_promotion_events_artifact ON arkvory_promotion_events(artifact_id, sequence);
    -- One row per published or in-flight copy; a pending row survives a crash and is resumed.
    CREATE TABLE arkvory_promotions (
      target_artifact_id uuid PRIMARY KEY REFERENCES arkvory_uploads(id),
      source_artifact_id uuid NOT NULL REFERENCES arkvory_uploads(id),
      source_repository varchar(64) NOT NULL,
      target_repository varchar(64) NOT NULL,
      mode text NOT NULL CHECK (mode IN ('copy','move')),
      state text NOT NULL CHECK (state IN ('pending','published')),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE INDEX arkvory_promotions_source ON arkvory_promotions(source_artifact_id, target_repository);
    INSERT INTO arkvory_migrations(version) VALUES(22);
  `);
}
