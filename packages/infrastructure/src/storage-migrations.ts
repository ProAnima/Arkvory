import type { PoolClient } from 'pg';
import { migrateStoragePolicy } from './storage-policy-schema.js';
import { migrateCleanup } from './cleanup-schema.js';

export async function migrateStorageSchemas(client: PoolClient) {
  await migrateStoragePolicy(client);
  await migrateCleanup(client);
  await migrateLargeObjects(client);
  await migrateUserTokens(client);
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
