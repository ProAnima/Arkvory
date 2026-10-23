import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { ModuleServiceError } from '@proanima/arkvory-extension-api';
import { requireDataName } from './module-data-paths.js';

export function resourceObject(value: unknown): void {
  if (typeof value !== 'object' || value === null) throw new ModuleServiceError('invalid_input');
}

export function resourceKey(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    Buffer.byteLength(value) > 256 ||
    value.includes('\0')
  )
    throw new ModuleServiceError('invalid_input', 'Invalid resource identity');
}

export function resourceKeys(values: unknown): string[] {
  if (!Array.isArray(values) || values.length > 1024)
    throw new ModuleServiceError('invalid_input', 'Invalid resource batch');
  const entries: readonly unknown[] = values;
  const checked: string[] = [];
  for (const value of entries) {
    resourceKey(value);
    checked.push(value);
  }
  return [...new Set(checked)].sort();
}

export function resourceName(value: unknown): asserts value is string {
  if (typeof value !== 'string' || Buffer.byteLength(value) > 1024)
    throw new ModuleServiceError('invalid_input', 'Invalid resource file');
  requireDataName(value);
}

/** Serializes bounded metadata operations; no module callback or filesystem I/O in a tx. */
export class ResourceCatalogDatabase {
  private pending = 0;
  private readonly lock: string;
  constructor(
    readonly pool: Pool,
    readonly moduleId: string,
    readonly readOnly: boolean,
  ) {
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(moduleId)) throw new ModuleServiceError('invalid_input');
    this.lock = createHash('sha256')
      .update(`resource-catalog:${moduleId}`)
      .digest()
      .readBigInt64BE()
      .toString();
  }

  /** Admission also covers restore requests waiting for a batch, not just open transactions. */
  admit(write = true): () => void {
    if (write && this.readOnly) throw new ModuleServiceError('read_only');
    if (this.pending >= 8) throw new ModuleServiceError('busy');
    this.pending++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.pending--;
    };
  }

  async run<T>(work: (client: PoolClient) => Promise<T>, write = true): Promise<T> {
    const release = this.admit(write);
    try {
      return await this.runAdmitted(work, write);
    } finally {
      release();
    }
  }

  /** Infrastructure-only: the caller must retain admission for every grouped request until
   * this transaction settles. No namespace, admission or DB object crosses the module port. */
  async runAdmitted<T>(work: (client: PoolClient) => Promise<T>, write = true): Promise<T> {
    if (write && this.readOnly) throw new ModuleServiceError('read_only');
    let client: PoolClient | undefined;
    try {
      client = await this.pool.connect();
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout='2s'");
      await client.query("SET LOCAL statement_timeout='5s'");
      if (write) await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [this.lock]);
      const value = await work(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      if (client) {
        try {
          await client.query('ROLLBACK');
        } catch {
          client.release(true);
          client = undefined;
        }
      }
      if (error instanceof ModuleServiceError) throw error;
      throw new ModuleServiceError('unavailable', 'Resource catalog unavailable');
    } finally {
      client?.release();
    }
  }

  async retain(client: PoolClient, owner: string, keys: readonly string[]): Promise<void> {
    const m = this.moduleId;
    await client.query(
      `INSERT INTO arkvory_module_resource_owners(module_id,owner) VALUES($1,$2)
      ON CONFLICT DO NOTHING`,
      [m, owner],
    );
    const state = await client.query<{ closed: boolean }>(
      'SELECT closed FROM arkvory_module_resource_owners WHERE module_id=$1 AND owner=$2',
      [m, owner],
    );
    if (state.rows[0]?.closed !== false)
      throw new ModuleServiceError('conflict', 'Resource owner closed');
    await client.query(
      `INSERT INTO arkvory_module_resources(module_id,key)
      SELECT $1,unnest($2::text[]) ON CONFLICT DO NOTHING`,
      [m, keys],
    );
    const doomed = await client.query(
      `SELECT 1 FROM arkvory_module_resources
      WHERE module_id=$1 AND key=ANY($2::text[]) AND state='doomed' LIMIT 1`,
      [m, keys],
    );
    if (doomed.rowCount) throw new ModuleServiceError('busy', 'Resource retiring');
    await client.query(
      `INSERT INTO arkvory_module_resource_refs(module_id,owner,key)
      SELECT $1,$2,unnest($3::text[]) ON CONFLICT DO NOTHING`,
      [m, owner, keys],
    );
    await client.query(
      `UPDATE arkvory_module_resources SET unclaimed_at=NULL
      WHERE module_id=$1 AND key=ANY($2::text[])`,
      [m, keys],
    );
  }
}
