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

export const MIRROR_RECOVERY_MIGRATION = 37;

/**
 * Expand-only (ADR 0058, 2026-10-12): `anchor` names the feed entry at the cursor, so a source
 * restored from a backup, whose new entries reuse sequence numbers, is recognised by that entry;
 * `detached_at` marks a repository detached from its mirror, which is never followed again from
 * its old cursor; `arkvory_mirror_adoptions` lists the versions an import has taken over, so a
 * repeated import neither brings back a stage removed here nor changes a version made here.
 */
export async function migrateMirrorRecovery(client: PoolClient): Promise<void> {
  if (
    (
      await client.query('SELECT version FROM arkvory_migrations WHERE version=$1', [
        MIRROR_RECOVERY_MIGRATION,
      ])
    ).rowCount
  )
    return;
  await client.query(`
    ALTER TABLE arkvory_mirror_state ADD COLUMN anchor text, ADD COLUMN detached_at timestamptz;
    CREATE TABLE arkvory_mirror_adoptions(
      repository text NOT NULL,
      artifact_id uuid NOT NULL REFERENCES arkvory_uploads(id),
      adopted_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (repository, artifact_id)
    );
    -- Copies published by a synchronization before this version were completed by it: settled.
    INSERT INTO arkvory_mirror_adoptions(repository, artifact_id)
    SELECT repository, id FROM arkvory_uploads
    WHERE owner = 'mirror:' || repository AND status = 'available'`);
  await client.query('INSERT INTO arkvory_migrations(version) VALUES($1)', [
    MIRROR_RECOVERY_MIGRATION,
  ]);
}

export const MIRROR_CONFLICTS_MIGRATION = 41;

/**
 * Expand-only (ADR 0058, 2026-10-15): entries of a source put aside on a conflict while the feed
 * goes on, one row per entry and repository. An entry is the artifact with the action and detail
 * that brought it; `entry` is the MD5 of action and detail, because an asset path may exceed the
 * size of an index entry. The artifact ID is the source's and need not exist here (another
 * repository may hold it), so there is no foreign key.
 */
export async function migrateMirrorConflicts(client: PoolClient): Promise<void> {
  if (
    (
      await client.query('SELECT version FROM arkvory_migrations WHERE version=$1', [
        MIRROR_CONFLICTS_MIGRATION,
      ])
    ).rowCount
  )
    return;
  await client.query(`
    CREATE TABLE IF NOT EXISTS arkvory_mirror_conflicts(
      repository text NOT NULL,
      artifact_id uuid NOT NULL,
      entry char(32) NOT NULL,
      action text NOT NULL,
      detail text,
      code text NOT NULL,
      first_at timestamptz NOT NULL,
      last_at timestamptz NOT NULL,
      attempts integer NOT NULL DEFAULT 1 CHECK (attempts >= 1),
      PRIMARY KEY (repository, artifact_id, entry)
    );
    CREATE INDEX IF NOT EXISTS arkvory_mirror_conflicts_due
      ON arkvory_mirror_conflicts(repository, last_at)`);
  await client.query('INSERT INTO arkvory_migrations(version) VALUES($1)', [
    MIRROR_CONFLICTS_MIGRATION,
  ]);
}
