import type { Pool, PoolClient } from 'pg';

export async function migrateModuleCursors(client: PoolClient): Promise<void> {
  if ((await client.query('SELECT 1 FROM arkvory_migrations WHERE version=48')).rowCount) return;
  await client.query(`CREATE TABLE IF NOT EXISTS arkvory_module_cursors (
    module_id varchar(32) NOT NULL, consumer varchar(32) NOT NULL,
    epoch uuid, position bigint NOT NULL DEFAULT 0 CHECK(position>=0),
    revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0), PRIMARY KEY(module_id,consumer));
    INSERT INTO arkvory_migrations(version) VALUES(48)`);
}
export interface ModuleCursor {
  readonly epoch: string | null;
  readonly position: bigint;
  readonly revision: bigint;
}
export class PostgresModuleCursors {
  constructor(private readonly pool: Pool) {}
  async read(module: string, consumer: string): Promise<ModuleCursor> {
    await this.pool.query(
      'INSERT INTO arkvory_module_cursors(module_id,consumer) VALUES($1,$2) ON CONFLICT DO NOTHING',
      [module, consumer],
    );
    const result = await this.pool.query<{
      epoch: string | null;
      position: string;
      revision: string;
    }>(
      'SELECT epoch::text,position::text,revision::text FROM arkvory_module_cursors WHERE module_id=$1 AND consumer=$2',
      [module, consumer],
    );
    const row = result.rows[0];
    if (!row) throw new Error('Module cursor missing');
    return { epoch: row.epoch, position: BigInt(row.position), revision: BigInt(row.revision) };
  }
  async save(
    module: string,
    consumer: string,
    before: ModuleCursor,
    epoch: string,
    position: bigint,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE arkvory_module_cursors SET epoch=$4,position=$5,revision=revision+1
      WHERE module_id=$1 AND consumer=$2 AND revision=$3`,
      [module, consumer, String(before.revision), epoch, String(position)],
    );
    return result.rowCount === 1;
  }
}
