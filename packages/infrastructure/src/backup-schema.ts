import type { PoolClient } from 'pg';

export const BACKUP_MIGRATION = 25;

/**
 * Version 25, expand-only: capture jobs with lease/fencing, durable pins of immutable content
 * ids and the single-row unlink admission barrier (ADR 0054). Older binaries never read these
 * tables; they also do not honour pins, which the capture detects through lock 18471/20.
 */
export async function migrateBackups(client: PoolClient): Promise<void> {
  if (
    (
      await client.query('SELECT version FROM arkvory_migrations WHERE version=$1', [
        BACKUP_MIGRATION,
      ])
    ).rowCount
  )
    return;
  await client.query(`
    CREATE TABLE arkvory_backup_jobs (
      id uuid PRIMARY KEY,
      kind text NOT NULL CHECK (kind IN ('capture')),
      state text NOT NULL CHECK (state IN ('running','committing','completed','failed','interrupted')),
      phase text NOT NULL CHECK (phase IN ('barrier','pins','tables','blobs','manifest','commit','done')),
      idempotency_key varchar(128) NOT NULL UNIQUE,
      vault_id uuid NOT NULL,
      point_id uuid NOT NULL UNIQUE,
      lease_owner uuid,
      generation bigint NOT NULL DEFAULT 1 CHECK (generation > 0),
      attempts integer NOT NULL DEFAULT 1 CHECK (attempts > 0),
      lease_until timestamptz,
      error_code varchar(64),
      snapshot_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      completed_at timestamptz,
      CHECK ((state IN ('running','committing')) = (lease_owner IS NOT NULL AND lease_until IS NOT NULL))
    );
    -- At most one unfinished capture per database, independent of advisory locks.
    CREATE UNIQUE INDEX arkvory_backup_jobs_active ON arkvory_backup_jobs(kind)
      WHERE state IN ('running','committing');
    CREATE TABLE arkvory_backup_pins (
      upload_id uuid NOT NULL REFERENCES arkvory_uploads(id),
      job_id uuid NOT NULL REFERENCES arkvory_backup_jobs(id),
      PRIMARY KEY (upload_id, job_id)
    );
    CREATE INDEX arkvory_backup_pins_job ON arkvory_backup_pins(job_id);
    CREATE TABLE arkvory_backup_barrier (
      singleton boolean PRIMARY KEY CHECK (singleton),
      state text NOT NULL CHECK (state IN ('open','closed')),
      job_id uuid REFERENCES arkvory_backup_jobs(id),
      generation bigint,
      changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CHECK ((state = 'closed') = (job_id IS NOT NULL AND generation IS NOT NULL))
    );
    INSERT INTO arkvory_backup_barrier(singleton, state) VALUES (true, 'open');
  `);
  await client.query('INSERT INTO arkvory_migrations(version) VALUES($1)', [BACKUP_MIGRATION]);
}
