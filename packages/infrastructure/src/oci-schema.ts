import type { PoolClient } from 'pg';

export const OCI_REGISTRY_MIGRATION = 30;

/**
 * Expand-only (ADR 0063): the container registry over ordinary artifacts. Blobs are shared by
 * the images of one repository (the access boundary), manifests and tags belong to an image.
 * Rows name artifacts by id; the artifact keeps the bytes, quota, access and backups. References
 * (manifest to its blobs and child manifests) keep retention away from the content of an image.
 * Uploads in progress are runtime state with their bytes in the staging directory.
 */
export async function migrateOciRegistry(client: PoolClient): Promise<void> {
  if (
    (
      await client.query('SELECT version FROM arkvory_migrations WHERE version=$1', [
        OCI_REGISTRY_MIGRATION,
      ])
    ).rowCount
  )
    return;
  await client.query(`
    CREATE TABLE arkvory_oci_blobs(
      repository text NOT NULL,
      digest text NOT NULL CHECK (digest ~ '^sha256:[a-f0-9]{64}$'),
      artifact_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (repository, digest)
    );
    CREATE TABLE arkvory_oci_manifests(
      repository text NOT NULL,
      image text NOT NULL,
      digest text NOT NULL CHECK (digest ~ '^sha256:[a-f0-9]{64}$'),
      artifact_id uuid NOT NULL,
      media_type text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (repository, image, digest)
    );
    CREATE TABLE arkvory_oci_tags(
      repository text NOT NULL,
      image text NOT NULL,
      tag text NOT NULL,
      digest text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (repository, image, tag),
      FOREIGN KEY (repository, image, digest)
        REFERENCES arkvory_oci_manifests(repository, image, digest) ON DELETE CASCADE
    );
    CREATE TABLE arkvory_oci_references(
      repository text NOT NULL,
      image text NOT NULL,
      manifest text NOT NULL,
      target text NOT NULL CHECK (target ~ '^sha256:[a-f0-9]{64}$'),
      PRIMARY KEY (repository, image, manifest, target),
      FOREIGN KEY (repository, image, manifest)
        REFERENCES arkvory_oci_manifests(repository, image, digest) ON DELETE CASCADE
    );
    CREATE INDEX arkvory_oci_references_target ON arkvory_oci_references(repository, target);
    -- Retention asks, per candidate artifact, whether the registry still uses it.
    CREATE INDEX arkvory_oci_blobs_artifact ON arkvory_oci_blobs(artifact_id);
    CREATE INDEX arkvory_oci_manifests_artifact ON arkvory_oci_manifests(artifact_id);
    CREATE TABLE arkvory_oci_uploads(
      id uuid PRIMARY KEY,
      repository text NOT NULL,
      image text NOT NULL,
      owner text NOT NULL,
      received bigint NOT NULL DEFAULT 0 CHECK (received >= 0),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX arkvory_oci_uploads_updated ON arkvory_oci_uploads(updated_at)`);
  await client.query('INSERT INTO arkvory_migrations(version) VALUES($1)', [
    OCI_REGISTRY_MIGRATION,
  ]);
}
