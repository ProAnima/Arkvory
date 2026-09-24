import type { PoolClient } from 'pg';
export async function migrateDelegations(c: PoolClient): Promise<void> {
  if ((await c.query('SELECT 1 FROM depot_migrations WHERE version=10')).rowCount) return;
  await c.query(`CREATE TABLE depot_service_delegations(
    key_id uuid NOT NULL REFERENCES depot_api_keys(id), target_account_id uuid NOT NULL REFERENCES depot_service_accounts(id),
    revision integer NOT NULL CHECK(revision>0), enabled boolean NOT NULL, actions text[] NOT NULL, ceiling jsonb NOT NULL,
    PRIMARY KEY(key_id,target_account_id));
    CREATE INDEX depot_delegations_target ON depot_service_delegations(target_account_id) WHERE enabled;
    ALTER TABLE depot_api_keys ADD COLUMN issued_via_key_id uuid REFERENCES depot_api_keys(id);
    INSERT INTO depot_migrations(version) VALUES(10);`);
}
