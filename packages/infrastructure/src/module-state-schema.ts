import type { PoolClient } from 'pg';

export async function migrateModuleState(client: PoolClient): Promise<void> {
  if ((await client.query('SELECT 1 FROM arkvory_migrations WHERE version=50')).rowCount) return;
  await client.query(`
    CREATE TABLE arkvory_module_state (
      module_id varchar(32) PRIMARY KEY CHECK(module_id ~ '^[a-z][a-z0-9-]{0,31}$'),
      revision bigint NOT NULL CHECK(revision>0),
      value bytea NOT NULL CHECK(octet_length(value)<=8388608)
    );
    INSERT INTO arkvory_migrations(version) VALUES(50);
  `);
}
