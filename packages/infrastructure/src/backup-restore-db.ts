import type { Pool, PoolClient } from 'pg';
import { BackupFailure, parseVaultJson } from '@proanima/arkvory-domain';
import type {
  Cancellation,
  RestoreDatabase,
  RestoreNormalization,
  RestoreTableSource,
} from '@proanima/arkvory-application';
import { migrate } from './migrations.js';
import { inTransaction } from './pg-transaction.js';
import { exportedTables, presentTablesQuery, quoteIdentifier } from './backup-tables.js';
import type { BackupTable } from './backup-tables.js';
import { normalizeRestore } from './backup-normalize.js';

export interface RestoreLoadOptions {
  readonly batchRows: number;
  /** Characters of one json_populate_recordset parameter. */
  readonly batchCharacters: number;
}
export const defaultRestoreLoadOptions: RestoreLoadOptions = {
  batchRows: 500,
  batchCharacters: 4 * 1024 * 1024,
};
interface Column {
  readonly name: string;
  readonly identity: boolean;
}

/**
 * Data-only restore into a database without Arkvory tables. No SQL from the backup is ever
 * executed: every row is a JSON object whose keys must equal the target columns, passed as a
 * bound parameter to json_populate_recordset. Statements are built only from the registry and
 * the target catalog.
 */
export class PostgresRestoreDatabase implements RestoreDatabase {
  constructor(
    private readonly pool: Pool,
    private readonly options: RestoreLoadOptions = defaultRestoreLoadOptions,
  ) {}

  async requireEmpty(): Promise<void> {
    const schema = await this.pool.query<{ schema: string | null }>(
      'SELECT current_schema() AS schema',
    );
    if (!schema.rows[0]?.schema)
      throw new BackupFailure('unavailable', 'Target database has no usable schema');
    const present = await this.pool.query(presentTablesQuery);
    if (present.rowCount)
      throw new BackupFailure('target_not_empty', 'Target database already has Arkvory tables');
  }

  async prepare(schemaVersion: number): Promise<void> {
    await this.requireEmpty();
    await migrate(this.pool, { upTo: schemaVersion });
  }

  async load(
    input: {
      schemaVersion: number;
      pointId: string;
      storageId: string;
      restoredAt: string;
      tables: readonly RestoreTableSource[];
    },
    cancellation: Cancellation,
  ): Promise<RestoreNormalization & { readonly rows: number }> {
    const sources = new Map(input.tables.map((table) => [table.name, table]));
    // Schema 25 exports exactly the registry; a manifest with another table set is foreign.
    if (
      sources.size !== input.tables.length ||
      sources.size !== exportedTables.length ||
      exportedTables.some((table) => !sources.has(table.name))
    )
      throw new BackupFailure('invalid_manifest', 'Point tables differ from the restore registry');
    return inTransaction(this.pool, async (client) => {
      await client.query('SET LOCAL statement_timeout = 0');
      const applied = await client.query<{ version: number | null }>(
        'SELECT max(version) AS version FROM arkvory_migrations',
      );
      if (applied.rows[0]?.version !== input.schemaVersion)
        throw new BackupFailure('schema_mismatch', 'Target schema differs from the backup');
      let rows = 0;
      for (const table of exportedTables) {
        const source = sources.get(table.name);
        if (!source) throw new BackupFailure('invalid_manifest', 'Missing table');
        const loaded = await this.loadTable(client, table, source, cancellation);
        if (loaded !== source.rows)
          throw new BackupFailure('integrity_mismatch', 'Row count differs from the manifest');
        rows += loaded;
      }
      for (const table of exportedTables) {
        const source = sources.get(table.name);
        if (source && table.deferred?.length)
          await this.updateDeferred(client, table, source, cancellation);
      }
      for (const table of exportedTables) await resetSequences(client, table.name);
      const normalization = await normalizeRestore(client, input);
      return { ...normalization, rows };
    });
  }

  async finish(): Promise<void> {
    await migrate(this.pool);
  }

  private async loadTable(
    client: PoolClient,
    table: BackupTable,
    source: RestoreTableSource,
    cancellation: Cancellation,
  ): Promise<number> {
    const columns = await tableColumns(client, table.name);
    const name = quoteIdentifier(table.name);
    const deferred = new Set(table.deferred ?? []);
    const values = columns.map((column) =>
      deferred.has(column.name)
        ? `(NULL::${name}).${quoteIdentifier(column.name)}`
        : `r.${quoteIdentifier(column.name)}`,
    );
    const overriding = columns.some((column) => column.identity) ? 'OVERRIDING SYSTEM VALUE' : '';
    const sql = `INSERT INTO ${name} (${columns.map((c) => quoteIdentifier(c.name)).join(', ')})
      ${overriding} SELECT ${values.join(', ')} FROM json_populate_recordset(NULL::${name}, $1::json) r`;
    return this.batches(source, columns, cancellation, (batch) => client.query(sql, [batch]));
  }

  private async updateDeferred(
    client: PoolClient,
    table: BackupTable,
    source: RestoreTableSource,
    cancellation: Cancellation,
  ): Promise<void> {
    const columns = await tableColumns(client, table.name);
    const name = quoteIdentifier(table.name);
    const assignments = (table.deferred ?? [])
      .map((column) => `${quoteIdentifier(column)} = r.${quoteIdentifier(column)}`)
      .join(', ');
    const match = table.key
      .map((column) => `d.${quoteIdentifier(column)} = r.${quoteIdentifier(column)}`)
      .join(' AND ');
    const sql = `UPDATE ${name} AS d SET ${assignments}
      FROM json_populate_recordset(NULL::${name}, $1::json) r WHERE ${match}`;
    await this.batches(source, columns, cancellation, (batch) => client.query(sql, [batch]));
  }

  /** Validated rows in bounded JSON arrays; the original line text is sent unchanged. */
  private async batches(
    source: RestoreTableSource,
    columns: readonly Column[],
    cancellation: Cancellation,
    send: (batch: string) => Promise<unknown>,
  ): Promise<number> {
    const expected = new Set(columns.map((column) => column.name));
    let batch: string[] = [];
    let characters = 0;
    let rows = 0;
    for await (const line of source.lines()) {
      cancellation.throwIfAborted();
      const row = parseVaultJson(line);
      if (typeof row !== 'object' || row === null || Array.isArray(row))
        throw new BackupFailure('invalid_manifest', 'Table row is not an object');
      const keys = Object.keys(row);
      if (keys.length !== expected.size || keys.some((key) => !expected.has(key)))
        throw new BackupFailure('invalid_manifest', 'Table row columns differ from the schema');
      batch.push(line);
      characters += line.length + 1;
      rows++;
      if (batch.length >= this.options.batchRows || characters >= this.options.batchCharacters) {
        await send('[' + batch.join(',') + ']');
        batch = [];
        characters = 0;
      }
    }
    if (batch.length) await send('[' + batch.join(',') + ']');
    return rows;
  }
}

async function tableColumns(client: PoolClient, table: string): Promise<readonly Column[]> {
  const result = await client.query<{ name: string; identity: string }>(
    `SELECT attname AS name, attidentity::text AS identity FROM pg_attribute
     WHERE attrelid=$1::text::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum`,
    [table],
  );
  return result.rows.map((row) => ({ name: row.name, identity: row.identity !== '' }));
}

/** Identity and serial sequences continue after the restored maximum. */
async function resetSequences(client: PoolClient, table: string): Promise<void> {
  const sequences = await client.query<{ name: string; sequence: string }>(
    `SELECT attname AS name, pg_get_serial_sequence($1::text, attname) AS sequence
     FROM pg_attribute WHERE attrelid=$1::text::regclass AND attnum>0 AND NOT attisdropped
     AND pg_get_serial_sequence($1::text, attname) IS NOT NULL`,
    [table],
  );
  for (const row of sequences.rows) {
    const column = quoteIdentifier(row.name);
    await client.query(
      `SELECT setval($1, COALESCE(max(${column}), 1), max(${column}) IS NOT NULL)
       FROM ${quoteIdentifier(table)}`,
      [row.sequence],
    );
  }
}
