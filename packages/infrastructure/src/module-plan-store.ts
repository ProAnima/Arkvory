import type { Pool, PoolClient } from 'pg';

export const MODULE_PLAN_MIGRATION = 43;

/**
 * Expand-only (ADR 0079, section 3): one row with the fingerprint of the writer's module plan.
 * Read gateways and the worker compare their own plan with it; nothing else reads the table, and
 * older releases ignore it. It stays out of backups: a restored installation's writer records its
 * own plan when it starts.
 */
export async function migrateModulePlan(client: PoolClient): Promise<void> {
  if (
    (
      await client.query('SELECT version FROM arkvory_migrations WHERE version=$1', [
        MODULE_PLAN_MIGRATION,
      ])
    ).rowCount
  )
    return;
  await client.query(`
    CREATE TABLE IF NOT EXISTS arkvory_module_plan(
      singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
      fingerprint char(64) NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
      recorded_at timestamptz NOT NULL DEFAULT now()
    )`);
  await client.query('INSERT INTO arkvory_migrations(version) VALUES($1)', [MODULE_PLAN_MIGRATION]);
}

const FINGERPRINT = /^[0-9a-f]{64}$/;

/** The installation's module plan as its writer recorded it (ADR 0079, section 3). */
export class PostgresModulePlan {
  constructor(private readonly pool: Pick<Pool, 'query'>) {}

  /**
   * Records the writer's plan. Only the process that owns the storage calls it, after claiming
   * it, so two writers never alternate their plans; a restart with the same plan rewrites the
   * same value.
   */
  async record(fingerprint: string): Promise<void> {
    if (!FINGERPRINT.test(fingerprint)) throw new TypeError('Invalid module plan fingerprint');
    await this.pool.query(
      `INSERT INTO arkvory_module_plan(singleton, fingerprint) VALUES(true, $1)
       ON CONFLICT (singleton) DO UPDATE SET fingerprint=excluded.fingerprint, recorded_at=now()`,
      [fingerprint],
    );
  }

  /** The recorded fingerprint, or null while no writer of this schema has started. */
  async read(): Promise<string | null> {
    const result = await this.pool.query<{ fingerprint: string }>(
      'SELECT fingerprint FROM arkvory_module_plan',
    );
    const fingerprint = result.rows[0]?.fingerprint ?? null;
    if (fingerprint !== null && !FINGERPRINT.test(fingerprint))
      throw new TypeError('Invalid recorded module plan');
    return fingerprint;
  }
}
