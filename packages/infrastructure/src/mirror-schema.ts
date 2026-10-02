import type { PoolClient } from 'pg';

export const MIRROR_STATE_MIGRATION = 28;

/**
 * Expand-only (ADR 0058): one row per mirrored repository of this installation. `source` binds
 * the row to the upstream origin and repository it follows; another source is never continued
 * from this cursor. Seed progress is a step and a page cursor, so a restart resumes the page.
 */
export async function migrateMirrorState(client: PoolClient): Promise<void> {
  if (
    (
      await client.query('SELECT version FROM arkvory_migrations WHERE version=$1', [
        MIRROR_STATE_MIGRATION,
      ])
    ).rowCount
  )
    return;
  await client.query(`
    CREATE TABLE arkvory_mirror_state(
      repository text PRIMARY KEY,
      source text NOT NULL,
      phase text NOT NULL CHECK (phase IN ('seeding','following')),
      seed_step text CHECK (seed_step IN ('artifacts','packages','assets')),
      seed_after text,
      seed_head bigint CHECK (seed_head >= 0),
      cursor bigint NOT NULL DEFAULT 0 CHECK (cursor >= 0),
      head bigint CHECK (head >= 0),
      checked_at timestamptz,
      synced_at timestamptz,
      error_code text,
      error_at timestamptz,
      copied_artifacts bigint NOT NULL DEFAULT 0 CHECK (copied_artifacts >= 0),
      copied_bytes bigint NOT NULL DEFAULT 0 CHECK (copied_bytes >= 0),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
  await client.query('INSERT INTO arkvory_migrations(version) VALUES($1)', [
    MIRROR_STATE_MIGRATION,
  ]);
}
