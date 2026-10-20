import type { Pool } from 'pg';
import { MAX_MODULE_STATE_BYTES, ModuleServiceError } from '@proanima/arkvory-extension-api';
import type {
  ModuleState,
  ModuleStateSnapshot,
  ModuleStateWrite,
} from '@proanima/arkvory-extension-api';

const MAX_REVISION = 9223372036854775807n;

/** All callers share PostgreSQL's atomic row compare-and-update; no process-local mutex. */
export class PostgresModuleState implements ModuleState {
  private pending = 0;
  constructor(
    private readonly pool: Pool,
    private readonly moduleId: string,
    private readonly readOnly: boolean,
  ) {
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(moduleId)) throw new ModuleServiceError('invalid_input');
  }

  async read(): Promise<ModuleStateSnapshot | null> {
    return this.admit(async () => {
      const result = await this.pool.query<{ revision: string; value: Buffer }>(
        'SELECT revision::text, value FROM arkvory_module_state WHERE module_id=$1',
        [this.moduleId],
      );
      const row = result.rows[0];
      return row ? { revision: row.revision, value: Uint8Array.from(row.value) } : null;
    });
  }

  async compareExchange(expected: string | null, value: Uint8Array): Promise<ModuleStateWrite> {
    return this.admit(() => this.replace(expected, value));
  }

  private async replace(expected: string | null, value: Uint8Array): Promise<ModuleStateWrite> {
    if (this.readOnly) throw new ModuleServiceError('read_only');
    if (
      expected !== null &&
      (typeof expected !== 'string' ||
        !/^[1-9][0-9]{0,18}$/.test(expected) ||
        BigInt(expected) >= MAX_REVISION)
    )
      throw new ModuleServiceError('invalid_input', 'Invalid state revision');
    if (!(value instanceof Uint8Array)) throw new ModuleServiceError('invalid_input');
    const length = value.byteLength;
    if (length > MAX_MODULE_STATE_BYTES)
      throw new ModuleServiceError('invalid_input', 'Invalid state size');
    const bytes = Buffer.from(value.subarray(0, length));
    // A single statement serializes both insert races and updates; no transaction spans module code.
    const result =
      expected === null
        ? await this.pool.query<{ revision: string }>(
            `INSERT INTO arkvory_module_state(module_id,revision,value) VALUES($1,1,$2)
           ON CONFLICT(module_id) DO NOTHING RETURNING revision::text`,
            [this.moduleId, bytes],
          )
        : await this.pool.query<{ revision: string }>(
            `UPDATE arkvory_module_state SET revision=revision+1,value=$3
           WHERE module_id=$1 AND revision=$2::bigint RETURNING revision::text`,
            [this.moduleId, expected, bytes],
          );
    const row = result.rows[0];
    return row ? { kind: 'stored', revision: row.revision } : { kind: 'conflict' };
  }

  private async admit<T>(work: () => Promise<T>): Promise<T> {
    if (this.pending >= 8) throw new ModuleServiceError('busy');
    this.pending++;
    try {
      return await work();
    } catch (error) {
      if (error instanceof ModuleServiceError) throw error;
      throw new ModuleServiceError('unavailable', 'Module state storage unavailable');
    } finally {
      this.pending--;
    }
  }
}
