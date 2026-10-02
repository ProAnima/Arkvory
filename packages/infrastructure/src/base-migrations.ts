import type { PoolClient } from 'pg';

/*
 * Historical base schema, versions 1-7. The SQL is frozen: released databases were migrated by
 * exactly these statements, so edits would make fresh and upgraded schemas diverge. Each step
 * records its own version in the same multi-statement query (simple protocol, no parameters).
 */
/** Version 1: upload reservations and their published descriptors. */
const initialUploads = `
        CREATE TABLE arkvory_uploads (
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
        CREATE INDEX arkvory_available ON arkvory_uploads(repository, id) WHERE status='available';
        INSERT INTO arkvory_migrations(version) VALUES(1);
      `;
/** Version 2: identity of the blob store bound to this catalog. */
const storageIdentity = `CREATE TABLE arkvory_storage_identity(singleton boolean PRIMARY KEY CHECK (singleton), storage_id uuid NOT NULL); INSERT INTO arkvory_migrations(version) VALUES(2)`;
/** Version 3: upload expiry, parts, annotations, packages, assets, references, audit, jobs. */
const catalogLifecycle = `
        ALTER TABLE arkvory_uploads ADD COLUMN expires_at timestamptz NOT NULL DEFAULT (now()+interval '7 days'), ADD COLUMN cancelled_at timestamptz, ADD COLUMN reclaimed boolean NOT NULL DEFAULT false;
        UPDATE arkvory_uploads SET cancelled_at=now() WHERE status='cancelled';
        CREATE TABLE arkvory_parts(upload_id uuid REFERENCES arkvory_uploads(id), part_index integer CHECK(part_index>=0 AND part_index<640), size integer NOT NULL CHECK(size>0 AND size<=8388608), sha256 char(64) NOT NULL, PRIMARY KEY(upload_id,part_index));
        CREATE TABLE arkvory_annotations(artifact_id uuid PRIMARY KEY REFERENCES arkvory_uploads(id), revision integer NOT NULL CHECK(revision>0), labels jsonb NOT NULL, metadata jsonb NOT NULL, collections jsonb NOT NULL);
        CREATE TABLE arkvory_packages(repository text NOT NULL, package_group text NOT NULL, name text NOT NULL, version text NOT NULL, artifact_id uuid NOT NULL REFERENCES arkvory_uploads(id), manifest jsonb NOT NULL, PRIMARY KEY(repository,package_group,name,version));
        CREATE UNIQUE INDEX arkvory_packages_identity ON arkvory_packages(repository,lower(package_group),lower(name),lower(version));
        CREATE TABLE arkvory_assets(repository text NOT NULL, path text NOT NULL, revision integer NOT NULL, artifact_id uuid NOT NULL REFERENCES arkvory_uploads(id), PRIMARY KEY(repository,path));
        CREATE TABLE arkvory_asset_revisions(repository text NOT NULL, path text NOT NULL, revision integer NOT NULL, artifact_id uuid NOT NULL REFERENCES arkvory_uploads(id), PRIMARY KEY(repository,path,revision));
        CREATE TABLE arkvory_references(repository text NOT NULL, artifact_id uuid REFERENCES arkvory_uploads(id), owner text NOT NULL, reference text NOT NULL, PRIMARY KEY(repository,artifact_id,owner,reference));
        CREATE TABLE arkvory_audit(sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, repository text NOT NULL, actor text NOT NULL, action text NOT NULL, artifact_id uuid NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now());
        CREATE INDEX arkvory_audit_repository ON arkvory_audit(repository,sequence);
        CREATE TABLE arkvory_jobs(id uuid PRIMARY KEY, repository text NOT NULL, upload_id uuid NOT NULL REFERENCES arkvory_uploads(id), owner text NOT NULL, status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','failed')), generation integer NOT NULL DEFAULT 0, attempts integer NOT NULL DEFAULT 0, lease_until timestamptz, available_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(), error_code text, UNIQUE(upload_id));
        CREATE INDEX arkvory_jobs_ready ON arkvory_jobs(status,available_at,created_at);
        INSERT INTO arkvory_migrations(version) VALUES(3);
      `;
/** Version 4: author, time and restore source of asset revisions; older rows keep NULL. */
const assetHistoryAuthors = `
        ALTER TABLE arkvory_asset_revisions
          ADD COLUMN actor text,
          ADD COLUMN created_at timestamptz,
          ADD COLUMN source_revision integer,
          ADD CONSTRAINT arkvory_asset_revision_positive CHECK(revision>0),
          ADD CONSTRAINT arkvory_asset_source_older CHECK(source_revision>0 AND source_revision<revision),
          ADD CONSTRAINT arkvory_asset_source_exists FOREIGN KEY(repository,path,source_revision) REFERENCES arkvory_asset_revisions(repository,path,revision);
        ALTER TABLE arkvory_asset_revisions ALTER COLUMN created_at SET DEFAULT now();
        INSERT INTO arkvory_migrations(version) VALUES(4);
      `;
/** Version 5: download admission policy and gateway slot leases. */
const downloadGateways = `
        CREATE TABLE arkvory_download_policy (
          singleton boolean PRIMARY KEY CHECK(singleton),
          slots integer NOT NULL CHECK(slots BETWEEN 2 AND 16),
          bytes_per_second bigint NOT NULL CHECK(bytes_per_second BETWEEN 131072 AND 1099511627776),
          principal_bytes_per_second bigint NOT NULL CHECK(principal_bytes_per_second>=0 AND principal_bytes_per_second<=1099511627776)
        );
        CREATE TABLE arkvory_gateway_leases (
          slot integer PRIMARY KEY CHECK(slot BETWEEN 0 AND 15),
          instance uuid NOT NULL,
          generation bigint NOT NULL CHECK(generation>0),
          expires_at timestamptz NOT NULL
        );
        INSERT INTO arkvory_migrations(version) VALUES(5);
      `;
/** Version 6: users, access groups, repository grants and sessions. */
const identities = `
        CREATE TABLE arkvory_users (
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
        CREATE UNIQUE INDEX arkvory_users_name ON arkvory_users(lower(name));
        CREATE TABLE arkvory_access_groups (
          id uuid PRIMARY KEY,
          name varchar(64) NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX arkvory_access_groups_name ON arkvory_access_groups(lower(name));
        CREATE TABLE arkvory_group_members (
          group_id uuid NOT NULL REFERENCES arkvory_access_groups(id) ON DELETE CASCADE,
          user_id uuid NOT NULL REFERENCES arkvory_users(id) ON DELETE CASCADE,
          PRIMARY KEY(group_id,user_id)
        );
        CREATE INDEX arkvory_group_members_user ON arkvory_group_members(user_id);
        CREATE TABLE arkvory_group_grants (
          group_id uuid NOT NULL REFERENCES arkvory_access_groups(id) ON DELETE CASCADE,
          repository varchar(64) NOT NULL,
          access text NOT NULL CHECK(access IN ('read','write')),
          PRIMARY KEY(group_id,repository)
        );
        CREATE TABLE arkvory_user_sessions (
          token_hash char(64) PRIMARY KEY,
          user_id uuid NOT NULL REFERENCES arkvory_users(id) ON DELETE CASCADE,
          expires_at timestamptz NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX arkvory_user_sessions_user ON arkvory_user_sessions(user_id);
        INSERT INTO arkvory_migrations(version) VALUES(6);
      `;
/** Version 7: sortable SemVer key used by package pages and the indexes of migration 8. */
const semverKey = `
        CREATE FUNCTION arkvory_semver_key(input_version text) RETURNS text
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
        INSERT INTO arkvory_migrations(version) VALUES(7);
      `;

const baseSteps: readonly { version: number; sql: string }[] = [
  { version: 1, sql: initialUploads },
  { version: 2, sql: storageIdentity },
  { version: 3, sql: catalogLifecycle },
  { version: 4, sql: assetHistoryAuthors },
  { version: 5, sql: downloadGateways },
  { version: 6, sql: identities },
  { version: 7, sql: semverKey },
];

/** Caller holds the migration transaction and advisory lock 18471/1; steps run in version order. */
export async function migrateBaseSchema(
  client: PoolClient,
  upTo = Number.MAX_SAFE_INTEGER,
): Promise<void> {
  for (const step of baseSteps) {
    if (step.version > upTo) continue;
    const applied = await client.query('SELECT version FROM arkvory_migrations WHERE version=$1', [
      step.version,
    ]);
    if (applied.rowCount === 0) await client.query(step.sql);
  }
}
