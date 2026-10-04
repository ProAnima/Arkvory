import type { PoolClient } from 'pg';

export const NPM_REGISTRY_MIGRATION = 32;

/**
 * Expand-only (ADR 0066): npm package versions over tarball artifacts and their dist-tags. The
 * manifest is the tarball's package.json kept as text (jsonb refuses some valid JSON strings);
 * a version is never rewritten unless its artifact is gone. Tags go with their version.
 */
export async function migrateNpmRegistry(client: PoolClient): Promise<void> {
  if (
    (
      await client.query('SELECT version FROM arkvory_migrations WHERE version=$1', [
        NPM_REGISTRY_MIGRATION,
      ])
    ).rowCount
  )
    return;
  await client.query(`
    CREATE TABLE arkvory_npm_versions(
      repository text NOT NULL,
      name text NOT NULL,
      version text NOT NULL,
      artifact_id uuid NOT NULL,
      file text NOT NULL,
      manifest text NOT NULL,
      description text,
      keywords text[] NOT NULL DEFAULT '{}',
      shasum text NOT NULL CHECK (shasum ~ '^[a-f0-9]{40}$'),
      integrity text NOT NULL,
      published_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (repository, name, version),
      UNIQUE (repository, name, file)
    );
    -- Retention asks, per candidate artifact, whether it holds a package version.
    CREATE INDEX arkvory_npm_versions_artifact ON arkvory_npm_versions(artifact_id);
    CREATE TABLE arkvory_npm_tags(
      repository text NOT NULL,
      name text NOT NULL,
      tag text NOT NULL,
      version text NOT NULL,
      PRIMARY KEY (repository, name, tag),
      FOREIGN KEY (repository, name, version)
        REFERENCES arkvory_npm_versions(repository, name, version) ON DELETE CASCADE
    )`);
  await client.query('INSERT INTO arkvory_migrations(version) VALUES($1)', [
    NPM_REGISTRY_MIGRATION,
  ]);
}
