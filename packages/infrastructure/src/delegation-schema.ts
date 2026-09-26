import type { PoolClient } from 'pg';
export async function migrateDelegations(c: PoolClient): Promise<void> {
  if ((await c.query('SELECT 1 FROM arkvory_migrations WHERE version=10')).rowCount) return;
  await c.query(`CREATE TABLE arkvory_service_delegations(
    key_id uuid NOT NULL REFERENCES arkvory_api_keys(id), target_account_id uuid NOT NULL REFERENCES arkvory_service_accounts(id),
    revision integer NOT NULL CHECK(revision>0), enabled boolean NOT NULL, actions text[] NOT NULL, ceiling jsonb NOT NULL,
    PRIMARY KEY(key_id,target_account_id));
    CREATE INDEX arkvory_delegations_target ON arkvory_service_delegations(target_account_id) WHERE enabled;
    ALTER TABLE arkvory_api_keys ADD COLUMN issued_via_key_id uuid REFERENCES arkvory_api_keys(id);
    INSERT INTO arkvory_migrations(version) VALUES(10);`);
}
