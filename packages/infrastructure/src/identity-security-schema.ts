import type { PoolClient } from 'pg';

/** Version 23 (22 is reserved for promotions developed in parallel). */
export const IDENTITY_SECURITY_MIGRATION = 23;

/**
 * Expand-only: old binaries keep working during a rolling update. They may still insert a token
 * without expiry or set the legacy 15-minute lock; new code bounds NULL expiry by creation time
 * and honours locked_until, so neither weakens the new rules.
 */
export async function migrateIdentitySecurity(client: PoolClient): Promise<void> {
  if (
    (
      await client.query('SELECT version FROM arkvory_migrations WHERE version=$1', [
        IDENTITY_SECURITY_MIGRATION,
      ])
    ).rowCount
  )
    return;
  await client.query(`
    CREATE TABLE arkvory_security_audit(
      id bigserial PRIMARY KEY,
      occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      actor varchar(160),
      credential varchar(16)
        CHECK (credential IN ('session','personal-token','service-key','file-key')),
      action varchar(64) NOT NULL,
      target varchar(160),
      outcome varchar(8) NOT NULL CHECK (outcome IN ('success','failure','denied')),
      code varchar(64),
      client_ip varchar(64),
      details jsonb NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(details)='object' AND octet_length(details::text)<=2048)
    );
    CREATE INDEX arkvory_security_audit_time ON arkvory_security_audit(occurred_at);
    CREATE FUNCTION arkvory_security_audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' AND current_setting('arkvory.security_audit_retention', true) = 'on' THEN
        RETURN OLD;
      END IF;
      RAISE EXCEPTION 'arkvory_security_audit is append-only';
    END;
    $$;
    CREATE TRIGGER arkvory_security_audit_append_only
      BEFORE UPDATE OR DELETE ON arkvory_security_audit
      FOR EACH ROW EXECUTE FUNCTION arkvory_security_audit_append_only();
    ALTER TABLE arkvory_user_tokens ADD COLUMN IF NOT EXISTS scope varchar(16) NOT NULL
      DEFAULT 'read-write' CHECK (scope IN ('read','read-write'));
    UPDATE arkvory_user_tokens SET expires_at=created_at+interval '365 days'
      WHERE expires_at IS NULL OR expires_at>created_at+interval '365 days';
    ALTER TABLE arkvory_users ADD COLUMN IF NOT EXISTS login_debt double precision NOT NULL
      DEFAULT 0 CHECK (login_debt>=0);
    ALTER TABLE arkvory_users ADD COLUMN IF NOT EXISTS login_debt_at timestamptz;
  `);
  await client.query('INSERT INTO arkvory_migrations(version) VALUES($1)', [
    IDENTITY_SECURITY_MIGRATION,
  ]);
}
