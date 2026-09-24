import { Pool } from 'pg';
import type { PoolClient } from 'pg';

const packagePageIndexes = [
  {
    name: 'depot_package_page_group_asc',
    order:
      '(lower(package_group COLLATE "C") COLLATE "C") ASC, (lower(name COLLATE "C") COLLATE "C") ASC, (depot_semver_key(version) COLLATE "C") DESC',
  },
  {
    name: 'depot_package_page_group_desc',
    order:
      '(lower(package_group COLLATE "C") COLLATE "C") DESC, (lower(name COLLATE "C") COLLATE "C") DESC, (depot_semver_key(version) COLLATE "C") DESC',
  },
  {
    name: 'depot_package_page_name_asc',
    order:
      '(lower(name COLLATE "C") COLLATE "C") ASC, (lower(package_group COLLATE "C") COLLATE "C") ASC, (depot_semver_key(version) COLLATE "C") DESC',
  },
  {
    name: 'depot_package_page_name_desc',
    order:
      '(lower(name COLLATE "C") COLLATE "C") DESC, (lower(package_group COLLATE "C") COLLATE "C") DESC, (depot_semver_key(version) COLLATE "C") DESC',
  },
  {
    name: 'depot_package_page_version_asc',
    order:
      '(depot_semver_key(version) COLLATE "C") ASC, (lower(package_group COLLATE "C") COLLATE "C") ASC, (lower(name COLLATE "C") COLLATE "C") ASC',
  },
  {
    name: 'depot_package_page_version_desc',
    order:
      '(depot_semver_key(version) COLLATE "C") DESC, (lower(package_group COLLATE "C") COLLATE "C") ASC, (lower(name COLLATE "C") COLLATE "C") ASC',
  },
] as const;

async function migratePackagePageIndexes(pool: Pool): Promise<void> {
  // Index builds can exceed the short request timeout on the runtime catalog pool.
  const migrationPool = new Pool({
    ...pool.options,
    max: 1,
    statement_timeout: 10 * 60 * 1000,
    query_timeout: 11 * 60 * 1000,
  });
  let client: PoolClient | undefined;
  let unusable = false;
  let locked = false;
  try {
    client = await migrationPool.connect();
    const deadline = Date.now() + 10 * 60 * 1000;
    let delay = 100;
    for (;;) {
      const attempt = await client.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock(18471, 9) AS locked',
      );
      locked = attempt.rows[0]?.locked === true;
      if (locked) break;
      if (Date.now() >= deadline) throw new Error('Timed out waiting for package index migration');
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, 1000);
    }
    const applied = await client.query('SELECT version FROM depot_migrations WHERE version=8');
    if (applied.rowCount !== 0) return;
    for (const index of packagePageIndexes) {
      const state = await client.query<{ indisvalid: boolean }>(
        'SELECT indisvalid FROM pg_index WHERE indexrelid=to_regclass($1::text)',
        [index.name],
      );
      if (state.rows[0]?.indisvalid === true) continue;
      if (state.rowCount !== 0) await client.query(`DROP INDEX CONCURRENTLY ${index.name}`);
      await client.query(
        `CREATE INDEX CONCURRENTLY ${index.name} ON depot_packages (repository, ${index.order}, (version COLLATE "C") ASC, ((artifact_id::text) COLLATE "C") ASC)`,
      );
    }
    await client.query('INSERT INTO depot_migrations(version) VALUES(8)');
  } catch (error) {
    unusable = true;
    throw error;
  } finally {
    if (client && locked && !unusable) {
      try {
        await client.query('SELECT pg_advisory_unlock(18471, 9)');
      } catch {
        unusable = true;
      }
    }
    client?.release(unusable);
    await migrationPool.end();
  }
}

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
    const gateways = await client.query('SELECT version FROM depot_migrations WHERE version=5');
    if (gateways.rowCount === 0) {
      await client.query(`
        CREATE TABLE depot_download_policy (
          singleton boolean PRIMARY KEY CHECK(singleton),
          slots integer NOT NULL CHECK(slots BETWEEN 2 AND 16),
          bytes_per_second bigint NOT NULL CHECK(bytes_per_second BETWEEN 131072 AND 1099511627776),
          principal_bytes_per_second bigint NOT NULL CHECK(principal_bytes_per_second>=0 AND principal_bytes_per_second<=1099511627776)
        );
        CREATE TABLE depot_gateway_leases (
          slot integer PRIMARY KEY CHECK(slot BETWEEN 0 AND 15),
          instance uuid NOT NULL,
          generation bigint NOT NULL CHECK(generation>0),
          expires_at timestamptz NOT NULL
        );
        INSERT INTO depot_migrations(version) VALUES(5);
      `);
    }
    const identities = await client.query('SELECT version FROM depot_migrations WHERE version=6');
    if (identities.rowCount === 0) {
      await client.query(`
        CREATE TABLE depot_users (
          id uuid PRIMARY KEY,
          name varchar(64) NOT NULL,
          password_salt char(32) NOT NULL,
          password_hash char(128) NOT NULL,
          administrator boolean NOT NULL DEFAULT false,
          enabled boolean NOT NULL DEFAULT true,
          failed_logins integer NOT NULL DEFAULT 0,
          locked_until timestamptz,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX depot_users_name ON depot_users(lower(name));
        CREATE TABLE depot_access_groups (
          id uuid PRIMARY KEY,
          name varchar(64) NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX depot_access_groups_name ON depot_access_groups(lower(name));
        CREATE TABLE depot_group_members (
          group_id uuid NOT NULL REFERENCES depot_access_groups(id) ON DELETE CASCADE,
          user_id uuid NOT NULL REFERENCES depot_users(id) ON DELETE CASCADE,
          PRIMARY KEY(group_id,user_id)
        );
        CREATE INDEX depot_group_members_user ON depot_group_members(user_id);
        CREATE TABLE depot_group_grants (
          group_id uuid NOT NULL REFERENCES depot_access_groups(id) ON DELETE CASCADE,
          repository varchar(64) NOT NULL,
          access text NOT NULL CHECK(access IN ('read','write')),
          PRIMARY KEY(group_id,repository)
        );
        CREATE TABLE depot_user_sessions (
          token_hash char(64) PRIMARY KEY,
          user_id uuid NOT NULL REFERENCES depot_users(id) ON DELETE CASCADE,
          expires_at timestamptz NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX depot_user_sessions_user ON depot_user_sessions(user_id);
        INSERT INTO depot_migrations(version) VALUES(6);
      `);
    }
    const packagePaging = await client.query(
      'SELECT version FROM depot_migrations WHERE version=7',
    );
    if (packagePaging.rowCount === 0) {
      await client.query(`
        CREATE FUNCTION depot_semver_key(input_version text) RETURNS text
        LANGUAGE plpgsql IMMUTABLE STRICT AS $$
        DECLARE
          core text := split_part(input_version, '+', 1);
          dash integer;
          main text;
          identifier text;
          result text := '';
        BEGIN
          dash := strpos(core, '-');
          main := CASE WHEN dash=0 THEN core ELSE left(core, dash-1) END;
          FOREACH identifier IN ARRAY string_to_array(main, '.') LOOP
            result := result || lpad(length(identifier)::text, 3, '0') || identifier;
          END LOOP;
          IF dash=0 THEN RETURN result || '1'; END IF;
          result := result || '0';
          FOREACH identifier IN ARRAY string_to_array(substr(core, dash+1), '.') LOOP
            IF identifier ~ '^[0-9]+$' THEN
              result := result || '0' || lpad(length(identifier)::text, 3, '0') || identifier;
            ELSE
              result := result || '1' || identifier;
            END IF;
            result := result || '!';
          END LOOP;
          RETURN result;
        END;
        $$;
        INSERT INTO depot_migrations(version) VALUES(7);
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
  await migratePackagePageIndexes(pool);
}
