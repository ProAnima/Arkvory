import type { PoolClient } from 'pg';

/** Schema version of the fleet tables (ADR 0077). */
export const FLEET_MIGRATION = 39;

/**
 * Tables of a site (pairing codes, the controllers it trusts) and of a controller (its sites).
 * Codes and keys are stored only as SHA-256; a site's key at the controller only encrypted with
 * a key outside the database. None of it is backed up: trust is paired again after a restore.
 */
export async function migrateFleet(client: PoolClient): Promise<void> {
  if (
    (
      await client.query('SELECT version FROM arkvory_migrations WHERE version=$1', [
        FLEET_MIGRATION,
      ])
    ).rowCount
  )
    return;
  await client.query(`
    CREATE TABLE IF NOT EXISTS arkvory_fleet_pairings(
      code_sha256 bytea PRIMARY KEY CHECK (length(code_sha256) = 32),
      created_by varchar(160) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL
    );
    CREATE TABLE IF NOT EXISTS arkvory_fleet_controllers(
      id uuid PRIMARY KEY,
      name varchar(63) NOT NULL,
      key_sha256 bytea NOT NULL UNIQUE CHECK (length(key_sha256) = 32),
      paired_by varchar(160) NOT NULL,
      paired_at timestamptz NOT NULL DEFAULT now(),
      used_at timestamptz,
      revoked_at timestamptz
    );
    CREATE TABLE IF NOT EXISTS arkvory_fleet_sites(
      id uuid PRIMARY KEY,
      name varchar(63) NOT NULL,
      url varchar(255) NOT NULL UNIQUE,
      -- SHA-256 of the pinned certificate's public key and the certificate; none on loopback HTTP.
      pin char(64),
      certificate text CHECK (certificate IS NULL OR length(certificate) <= 16384),
      key_box bytea NOT NULL,
      added_by varchar(160) NOT NULL,
      added_at timestamptz NOT NULL DEFAULT now(),
      seen_at timestamptz,
      state varchar(16) NOT NULL DEFAULT 'pending',
      error varchar(64),
      topology jsonb CHECK (topology IS NULL OR octet_length(topology::text) <= 262144)
    );
    -- Fleet keys and download links act too: the audit names how they authenticated.
    ALTER TABLE arkvory_security_audit DROP CONSTRAINT IF EXISTS arkvory_security_audit_credential_check;
    ALTER TABLE arkvory_security_audit ADD CONSTRAINT arkvory_security_audit_credential_check
      CHECK (credential IN ('session','personal-token','service-key','file-key','transfer-token','fleet-key'))
      NOT VALID;`);
  await client.query('INSERT INTO arkvory_migrations(version) VALUES($1)', [FLEET_MIGRATION]);
}
