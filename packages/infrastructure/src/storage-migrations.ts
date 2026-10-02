import type { PoolClient } from 'pg';
import { migrateStoragePolicy } from './storage-policy-schema.js';
import { migrateCleanup } from './cleanup-schema.js';
import { migratePromotions } from './promotion-schema.js';
import { migrateIdentitySecurity } from './identity-security-schema.js';
import { migrateRequestCorrelation } from './correlation-schema.js';
import { migrateBackups } from './backup-schema.js';
import { migrateUnattendedBackups } from './backup-agent-schema.js';

/** Steps of versions 15-26 in their historical order; each records its own version. */
const storageSteps: readonly (readonly [number, (client: PoolClient) => Promise<void>])[] = [
  [15, migrateStoragePolicy],
  [16, migrateCleanup],
  [18, migrateLargeObjects],
  [19, migrateUserTokens],
  [20, migrateStorageRouting],
  [21, migrateAdaptiveParts],
  [22, migratePromotions],
  [23, migrateIdentitySecurity],
  [24, migrateRequestCorrelation],
  [25, migrateBackups],
  [26, migrateUnattendedBackups],
];

/** upTo bounds the applied versions (restore of an older backup); the order never changes. */
export async function migrateStorageSchemas(client: PoolClient, upTo = Number.MAX_SAFE_INTEGER) {
  for (const [version, step] of storageSteps) if (version <= upTo) await step(client);
}

export async function migrateLargeObjects(client: PoolClient): Promise<void> {
  if ((await client.query('SELECT version FROM arkvory_migrations WHERE version=18')).rowCount)
    return;
  await client.query(`
    DO $$
    DECLARE
      c RECORD;
    BEGIN
      FOR c IN (
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'arkvory_uploads'::regclass AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%size%'
      ) LOOP
        EXECUTE 'ALTER TABLE arkvory_uploads DROP CONSTRAINT ' || quote_ident(c.conname);
      END LOOP;
      FOR c IN (
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'arkvory_parts'::regclass AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%part_index%'
      ) LOOP
        EXECUTE 'ALTER TABLE arkvory_parts DROP CONSTRAINT ' || quote_ident(c.conname);
      END LOOP;
    END $$;
    ALTER TABLE arkvory_uploads ADD CONSTRAINT arkvory_uploads_size_check CHECK (size >= 0 AND size <= 68719476736);
    ALTER TABLE arkvory_parts ADD CONSTRAINT arkvory_parts_part_index_check CHECK (part_index >= 0 AND part_index < 10000);
    INSERT INTO arkvory_migrations(version) VALUES(18);
  `);
}

export async function migrateUserTokens(client: PoolClient): Promise<void> {
  if ((await client.query('SELECT version FROM arkvory_migrations WHERE version=19')).rowCount)
    return;
  await client.query(`
    CREATE TABLE arkvory_user_tokens (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES arkvory_users(id) ON DELETE CASCADE,
      name varchar(64) NOT NULL,
      token_hash char(64) NOT NULL UNIQUE,
      token_prefix varchar(16) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz,
      last_used_at timestamptz,
      revoked_at timestamptz
    );
    CREATE INDEX arkvory_user_tokens_user ON arkvory_user_tokens(user_id);
    INSERT INTO arkvory_migrations(version) VALUES(19);
  `);
}

export async function migrateStorageRouting(client: PoolClient): Promise<void> {
  if ((await client.query('SELECT version FROM arkvory_migrations WHERE version=20')).rowCount)
    return;
  await client.query(`
    ALTER TABLE arkvory_uploads ADD COLUMN IF NOT EXISTS storage_backend varchar(64) NOT NULL DEFAULT 'default';
    INSERT INTO arkvory_migrations(version) VALUES(20);
  `);
}

export async function migrateAdaptiveParts(client: PoolClient): Promise<void> {
  if ((await client.query('SELECT version FROM arkvory_migrations WHERE version=21')).rowCount)
    return;
  // Relaxing CHECKs: NOT VALID adds the new bound without a rewrite; VALIDATE only reads rows.
  await client.query(`
    ALTER TABLE arkvory_uploads ADD COLUMN IF NOT EXISTS part_bytes integer NOT NULL DEFAULT 8388608;
    ALTER TABLE arkvory_uploads DROP CONSTRAINT IF EXISTS arkvory_uploads_part_bytes_check;
    ALTER TABLE arkvory_uploads ADD CONSTRAINT arkvory_uploads_part_bytes_check
      CHECK (part_bytes >= 8388608 AND part_bytes <= 1073741824 AND part_bytes % 8388608 = 0) NOT VALID;
    ALTER TABLE arkvory_uploads VALIDATE CONSTRAINT arkvory_uploads_part_bytes_check;
    ALTER TABLE arkvory_uploads DROP CONSTRAINT IF EXISTS arkvory_uploads_size_check;
    ALTER TABLE arkvory_uploads ADD CONSTRAINT arkvory_uploads_size_check
      CHECK (size >= 0 AND size <= 10737418240000) NOT VALID;
    ALTER TABLE arkvory_uploads VALIDATE CONSTRAINT arkvory_uploads_size_check;
    DO $$
    DECLARE
      c RECORD;
    BEGIN
      FOR c IN (
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'arkvory_parts'::regclass AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%8388608%'
      ) LOOP
        EXECUTE 'ALTER TABLE arkvory_parts DROP CONSTRAINT ' || quote_ident(c.conname);
      END LOOP;
    END $$;
    ALTER TABLE arkvory_parts DROP CONSTRAINT IF EXISTS arkvory_parts_size_check;
    ALTER TABLE arkvory_parts ADD CONSTRAINT arkvory_parts_size_check
      CHECK (size > 0 AND size <= 1073741824) NOT VALID;
    ALTER TABLE arkvory_parts VALIDATE CONSTRAINT arkvory_parts_size_check;
    INSERT INTO arkvory_migrations(version) VALUES(21);
  `);
}
