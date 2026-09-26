import type { PoolClient } from 'pg';

export async function migrateServices(client: PoolClient): Promise<void> {
  if ((await client.query('SELECT 1 FROM arkvory_migrations WHERE version=9')).rowCount) return;
  await client.query(`
    CREATE TABLE arkvory_service_accounts(
      id uuid PRIMARY KEY, name varchar(64) NOT NULL UNIQUE, enabled boolean NOT NULL DEFAULT true,
      revision integer NOT NULL DEFAULT 1 CHECK(revision>0), bindings jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE arkvory_api_keys(
      id uuid PRIMARY KEY, account_id uuid NOT NULL REFERENCES arkvory_service_accounts(id),
      name varchar(64) NOT NULL, secret_hash char(64) NOT NULL UNIQUE, bindings jsonb NOT NULL,
      state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','active','revoked')),
      created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
      activation_expires_at timestamptz NOT NULL DEFAULT (now()+interval '15 minutes'),
      rotated_from uuid REFERENCES arkvory_api_keys(id), issued_by text NOT NULL,
      idempotency_key varchar(128) NOT NULL, fingerprint char(64) NOT NULL,
      UNIQUE(account_id,issued_by,idempotency_key));
    CREATE INDEX arkvory_api_keys_account ON arkvory_api_keys(account_id,id);
    CREATE TABLE arkvory_service_audit(
      sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor text NOT NULL,
      action text NOT NULL, account_id uuid NOT NULL, key_id uuid,
      occurred_at timestamptz NOT NULL DEFAULT now());
    CREATE INDEX arkvory_service_audit_account ON arkvory_service_audit(account_id,sequence);
    ALTER TABLE arkvory_jobs ADD COLUMN credential_id uuid REFERENCES arkvory_api_keys(id);
    INSERT INTO arkvory_migrations(version) VALUES(9);
  `);
}
