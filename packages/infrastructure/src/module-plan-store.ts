import type { Pool, PoolClient } from 'pg';

export const MODULE_PLAN_MIGRATION = 43;

/**
 * Expand-only (ADR 0079, section 3): one row with the fingerprints of the writer's module plan.
 * Read gateways and the worker compare the compatibility fingerprint with theirs; the full one,
 * with every version, is kept for operators. Nothing else reads the table, and older releases
 * ignore it. It stays out of backups: a restored installation's writer records its own plan when
 * it starts.
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
      compatibility_fingerprint char(64) NOT NULL
        CHECK (compatibility_fingerprint ~ '^[0-9a-f]{64}$'),
      fingerprint char(64) NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
      recorded_at timestamptz NOT NULL DEFAULT now()
    )`);
  await client.query('INSERT INTO arkvory_migrations(version) VALUES($1)', [MODULE_PLAN_MIGRATION]);
}

/** The two fingerprints of a plan (`ModulePlan` of `extension-api`). */
export interface ModulePlanFingerprints {
  /** What the processes of the installation must agree on; no versions of built-in modules. */
  readonly compatibilityFingerprint: string;
  /** The exact build of the plan, with the core version and every module version. */
  readonly fingerprint: string;
}

const FINGERPRINT = /^[0-9a-f]{64}$/;

/** The installation's module plan as its writer recorded it (ADR 0079, section 3). */
export class PostgresModulePlan {
  constructor(private readonly pool: Pick<Pool, 'query'>) {}

  /**
   * Records the writer's plan. Only the process that owns the storage calls it, after claiming
   * it, so two writers never alternate their plans; a restart with the same plan rewrites the
   * same values.
   */
  async record(plan: ModulePlanFingerprints): Promise<void> {
    if (!FINGERPRINT.test(plan.compatibilityFingerprint) || !FINGERPRINT.test(plan.fingerprint))
      throw new TypeError('Invalid module plan fingerprint');
    await this.pool.query(
      `INSERT INTO arkvory_module_plan(singleton, compatibility_fingerprint, fingerprint)
       VALUES(true, $1, $2)
       ON CONFLICT (singleton) DO UPDATE SET
         compatibility_fingerprint=excluded.compatibility_fingerprint,
         fingerprint=excluded.fingerprint, recorded_at=now()`,
      [plan.compatibilityFingerprint, plan.fingerprint],
    );
  }

  /** The recorded fingerprints, or null while no writer of this schema has started. */
  async read(): Promise<ModulePlanFingerprints | null> {
    const result = await this.pool.query<{
      compatibility_fingerprint: string;
      fingerprint: string;
    }>('SELECT compatibility_fingerprint, fingerprint FROM arkvory_module_plan');
    const row = result.rows[0];
    if (row === undefined) return null;
    if (!FINGERPRINT.test(row.compatibility_fingerprint) || !FINGERPRINT.test(row.fingerprint))
      throw new TypeError('Invalid recorded module plan');
    return {
      compatibilityFingerprint: row.compatibility_fingerprint,
      fingerprint: row.fingerprint,
    };
  }
}
