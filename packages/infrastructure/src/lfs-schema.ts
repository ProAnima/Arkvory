import type { PoolClient } from 'pg';

export const GIT_LFS_MIGRATION = 31;

/**
 * Expand-only (ADR 0065): Git LFS objects over artifacts and file locks. An object row names
 * the artifact holding the bytes of an oid in a repository (the access boundary); the artifact
 * keeps bytes, quota and backups. A lock holds a path of the git repository for one owner;
 * the owner's name is kept as it was when the lock was taken.
 */
export async function migrateGitLfs(client: PoolClient): Promise<void> {
  if (
    (
      await client.query('SELECT version FROM arkvory_migrations WHERE version=$1', [
        GIT_LFS_MIGRATION,
      ])
    ).rowCount
  )
    return;
  await client.query(`
    CREATE TABLE arkvory_lfs_objects(
      repository text NOT NULL,
      oid text NOT NULL CHECK (oid ~ '^[a-f0-9]{64}$'),
      artifact_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (repository, oid)
    );
    -- Retention asks, per candidate artifact, whether it holds an LFS object.
    CREATE INDEX arkvory_lfs_objects_artifact ON arkvory_lfs_objects(artifact_id);
    CREATE TABLE arkvory_lfs_locks(
      id uuid PRIMARY KEY,
      repository text NOT NULL,
      path text NOT NULL,
      owner_id text NOT NULL,
      owner_name text NOT NULL,
      locked_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (repository, path)
    )`);
  await client.query('INSERT INTO arkvory_migrations(version) VALUES($1)', [GIT_LFS_MIGRATION]);
}
