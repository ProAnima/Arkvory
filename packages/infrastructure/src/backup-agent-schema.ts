import type { PoolClient } from 'pg';

export const UNATTENDED_BACKUP_MIGRATION = 26;
export const BACKUP_VAULT_ENCRYPTION_MIGRATION = 34;

const planTable = `
    CREATE TABLE arkvory_backup_plan (
      singleton boolean PRIMARY KEY CHECK (singleton),
      enabled boolean NOT NULL,
      hour smallint NOT NULL CHECK (hour BETWEEN 0 AND 23),
      minute smallint NOT NULL CHECK (minute BETWEEN 0 AND 59),
      timezone varchar(64) NOT NULL,
      keep_daily smallint NOT NULL CHECK (keep_daily BETWEEN 0 AND 366),
      keep_weekly smallint NOT NULL CHECK (keep_weekly BETWEEN 0 AND 260),
      keep_monthly smallint NOT NULL CHECK (keep_monthly BETWEEN 0 AND 120),
      revision integer NOT NULL CHECK (revision > 0),
      schedule_from timestamptz NOT NULL DEFAULT clock_timestamp(),
      last_slot_at timestamptz,
      updated_by varchar(160),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    INSERT INTO arkvory_backup_plan(singleton, enabled, hour, minute, timezone, keep_daily,
      keep_weekly, keep_monthly, revision) VALUES (true, false, 2, 0, 'UTC', 7, 4, 6, 1);
`;
const agentTable = `    CREATE TABLE arkvory_backup_agent (
      singleton boolean PRIMARY KEY CHECK (singleton),
      owner uuid,
      generation bigint NOT NULL DEFAULT 0 CHECK (generation >= 0),
      lease_until timestamptz,
      heartbeat_at timestamptz,
      started_at timestamptz,
      version varchar(64),
      vault_configured boolean NOT NULL DEFAULT false,
      vault_id uuid,
      vault_available boolean NOT NULL DEFAULT false,
      vault_free_bytes bigint CHECK (vault_free_bytes >= 0),
      vault_total_bytes bigint CHECK (vault_total_bytes >= 0),
      last_error varchar(64),
      CHECK ((owner IS NULL) = (lease_until IS NULL))
    );
    INSERT INTO arkvory_backup_agent(singleton) VALUES (true);
`;
const requestTable = `    CREATE TABLE arkvory_backup_requests (
      id uuid PRIMARY KEY,
      kind text NOT NULL CHECK (kind IN ('capture','verify','retention')),
      point_id uuid,
      depth text CHECK (depth IN ('structural','deep')),
      idempotency_key varchar(128) NOT NULL,
      requested_by varchar(160) NOT NULL,
      request_id varchar(128),
      state text NOT NULL CHECK (state IN ('queued','running','done','failed')),
      phase varchar(32),
      error_code varchar(64),
      attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      agent_generation bigint,
      job_id uuid REFERENCES arkvory_backup_jobs(id),
      bytes_done bigint NOT NULL DEFAULT 0 CHECK (bytes_done >= 0),
      bytes_total bigint NOT NULL DEFAULT 0 CHECK (bytes_total >= 0),
      blobs_done bigint NOT NULL DEFAULT 0 CHECK (blobs_done >= 0),
      blobs_total bigint NOT NULL DEFAULT 0 CHECK (blobs_total >= 0),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      started_at timestamptz,
      finished_at timestamptz,
      UNIQUE (requested_by, kind, idempotency_key),
      CHECK (kind <> 'verify' OR (point_id IS NOT NULL AND depth IS NOT NULL)),
      CHECK (kind = 'verify' OR depth IS NULL)
    );
    CREATE INDEX arkvory_backup_requests_open ON arkvory_backup_requests(created_at, id)
      WHERE state IN ('queued','running');
    CREATE INDEX arkvory_backup_requests_page ON arkvory_backup_requests(created_at, id);
    CREATE INDEX arkvory_backup_requests_job ON arkvory_backup_requests(job_id)
      WHERE job_id IS NOT NULL;
`;
const pointTable = `    CREATE TABLE arkvory_backup_points (
      id uuid PRIMARY KEY,
      vault_id uuid NOT NULL,
      job_id uuid NOT NULL,
      snapshot_at timestamptz NOT NULL,
      completed_at timestamptz NOT NULL,
      blobs bigint NOT NULL CHECK (blobs >= 0),
      content_bytes bigint NOT NULL CHECK (content_bytes >= 0),
      new_bytes bigint NOT NULL CHECK (new_bytes >= 0),
      tables integer NOT NULL CHECK (tables >= 0),
      rows bigint NOT NULL CHECK (rows >= 0),
      pinned boolean NOT NULL DEFAULT false,
      verified_at timestamptz,
      verify_depth text CHECK (verify_depth IN ('structural','deep')),
      verify_error varchar(64),
      deep_verified_at timestamptz,
      forgotten_at timestamptz,
      cataloged_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CHECK ((verified_at IS NULL) = (verify_depth IS NULL))
    );
    CREATE INDEX arkvory_backup_points_live ON arkvory_backup_points(vault_id, snapshot_at, id)
      WHERE forgotten_at IS NULL;
    ALTER TABLE arkvory_backup_jobs
      ADD COLUMN bytes_copied bigint NOT NULL DEFAULT 0 CHECK (bytes_copied >= 0),
      ADD COLUMN bytes_total bigint NOT NULL DEFAULT 0 CHECK (bytes_total >= 0),
      ADD COLUMN blobs_copied bigint NOT NULL DEFAULT 0 CHECK (blobs_copied >= 0),
      ADD COLUMN blobs_total bigint NOT NULL DEFAULT 0 CHECK (blobs_total >= 0);
`;

/**
 * Version 26, expand-only (ADR 0056): the single-row plan, the agent lease and heartbeat row,
 * requests of the API to the agent, the point catalog cache and progress counters on capture
 * jobs. New columns have constant defaults, so schema 25 binaries keep writing capture jobs.
 */
export async function migrateUnattendedBackups(client: PoolClient): Promise<void> {
  if (
    (
      await client.query('SELECT version FROM arkvory_migrations WHERE version=$1', [
        UNATTENDED_BACKUP_MIGRATION,
      ])
    ).rowCount
  )
    return;
  for (const statement of [planTable, agentTable, requestTable, pointTable])
    await client.query(statement);
  await client.query('INSERT INTO arkvory_migrations(version) VALUES($1)', [
    UNATTENDED_BACKUP_MIGRATION,
  ]);
}

/**
 * Version 34, expand-only (ADR 0070): whether the vault the agent reports is encrypted. NULL
 * means unknown: no heartbeat yet, an agent that predates the column, or a vault.json the agent
 * could not read. Older binaries never name the column, so they keep writing heartbeats.
 */
export async function migrateBackupVaultEncryption(client: PoolClient): Promise<void> {
  if (
    (
      await client.query('SELECT version FROM arkvory_migrations WHERE version=$1', [
        BACKUP_VAULT_ENCRYPTION_MIGRATION,
      ])
    ).rowCount
  )
    return;
  await client.query(
    'ALTER TABLE arkvory_backup_agent ADD COLUMN IF NOT EXISTS vault_encrypted boolean',
  );
  await client.query('INSERT INTO arkvory_migrations(version) VALUES($1)', [
    BACKUP_VAULT_ENCRYPTION_MIGRATION,
  ]);
}
