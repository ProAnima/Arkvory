import type { Pool } from 'pg';

export async function migrate(pool: Pool): Promise<void> {
  const client = await pool.connect();
  let unusable = false;
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(18471, 1)');
    await client.query(
      `CREATE TABLE IF NOT EXISTS depot_migrations(version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
    );
    const applied = await client.query('SELECT version FROM depot_migrations WHERE version=1');
    if (applied.rowCount === 0) {
      await client.query(`
        CREATE TABLE depot_uploads (
          id uuid PRIMARY KEY,
          repository varchar(64) NOT NULL,
          owner varchar(128) NOT NULL,
          idempotency_key varchar(128) NOT NULL,
          descriptor jsonb NOT NULL,
          size bigint NOT NULL CHECK (size >= 0 AND size <= 5368709120),
          status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','available','cancelled')),
          created_at timestamptz NOT NULL,
          UNIQUE (repository, owner, idempotency_key)
        );
        CREATE INDEX depot_available ON depot_uploads(repository, id) WHERE status='available';
        INSERT INTO depot_migrations(version) VALUES(1);
      `);
    }
    const identityMigration = await client.query(
      'SELECT version FROM depot_migrations WHERE version=2',
    );
    if (identityMigration.rowCount === 0) {
      await client.query(
        `CREATE TABLE depot_storage_identity(singleton boolean PRIMARY KEY CHECK (singleton), storage_id uuid NOT NULL); INSERT INTO depot_migrations(version) VALUES(2)`,
      );
    }
    const lifecycle = await client.query('SELECT version FROM depot_migrations WHERE version=3');
    if (lifecycle.rowCount === 0) {
      await client.query(`
        ALTER TABLE depot_uploads ADD COLUMN expires_at timestamptz NOT NULL DEFAULT (now()+interval '7 days'), ADD COLUMN cancelled_at timestamptz, ADD COLUMN reclaimed boolean NOT NULL DEFAULT false;
        UPDATE depot_uploads SET cancelled_at=now() WHERE status='cancelled';
        CREATE TABLE depot_parts(upload_id uuid REFERENCES depot_uploads(id), part_index integer CHECK(part_index>=0 AND part_index<640), size integer NOT NULL CHECK(size>0 AND size<=8388608), sha256 char(64) NOT NULL, PRIMARY KEY(upload_id,part_index));
        CREATE TABLE depot_annotations(artifact_id uuid PRIMARY KEY REFERENCES depot_uploads(id), revision integer NOT NULL CHECK(revision>0), labels jsonb NOT NULL, metadata jsonb NOT NULL, collections jsonb NOT NULL);
        CREATE TABLE depot_packages(repository text NOT NULL, package_group text NOT NULL, name text NOT NULL, version text NOT NULL, artifact_id uuid NOT NULL REFERENCES depot_uploads(id), manifest jsonb NOT NULL, PRIMARY KEY(repository,package_group,name,version));
        CREATE UNIQUE INDEX depot_packages_identity ON depot_packages(repository,lower(package_group),lower(name),lower(version));
        CREATE TABLE depot_assets(repository text NOT NULL, path text NOT NULL, revision integer NOT NULL, artifact_id uuid NOT NULL REFERENCES depot_uploads(id), PRIMARY KEY(repository,path));
        CREATE TABLE depot_asset_revisions(repository text NOT NULL, path text NOT NULL, revision integer NOT NULL, artifact_id uuid NOT NULL REFERENCES depot_uploads(id), PRIMARY KEY(repository,path,revision));
        CREATE TABLE depot_references(repository text NOT NULL, artifact_id uuid REFERENCES depot_uploads(id), owner text NOT NULL, reference text NOT NULL, PRIMARY KEY(repository,artifact_id,owner,reference));
        CREATE TABLE depot_audit(sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, repository text NOT NULL, actor text NOT NULL, action text NOT NULL, artifact_id uuid NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now());
        CREATE INDEX depot_audit_repository ON depot_audit(repository,sequence);
        CREATE TABLE depot_jobs(id uuid PRIMARY KEY, repository text NOT NULL, upload_id uuid NOT NULL REFERENCES depot_uploads(id), owner text NOT NULL, status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','failed')), generation integer NOT NULL DEFAULT 0, attempts integer NOT NULL DEFAULT 0, lease_until timestamptz, available_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(), error_code text, UNIQUE(upload_id));
        CREATE INDEX depot_jobs_ready ON depot_jobs(status,available_at,created_at);
        INSERT INTO depot_migrations(version) VALUES(3);
      `);
    }
    const history = await client.query('SELECT version FROM depot_migrations WHERE version=4');
    if (history.rowCount === 0) {
      await client.query(`
        ALTER TABLE depot_asset_revisions
          ADD COLUMN actor text,
          ADD COLUMN created_at timestamptz,
          ADD COLUMN source_revision integer,
          ADD CONSTRAINT depot_asset_revision_positive CHECK(revision>0),
          ADD CONSTRAINT depot_asset_source_older CHECK(source_revision>0 AND source_revision<revision),
          ADD CONSTRAINT depot_asset_source_exists FOREIGN KEY(repository,path,source_revision) REFERENCES depot_asset_revisions(repository,path,revision);
        ALTER TABLE depot_asset_revisions ALTER COLUMN created_at SET DEFAULT now();
        INSERT INTO depot_migrations(version) VALUES(4);
      `);
    }
    await client.query('COMMIT');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      unusable = true;
    }
    throw error;
  } finally {
    client.release(unusable);
  }
}
