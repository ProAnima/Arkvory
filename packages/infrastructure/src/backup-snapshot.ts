import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { BackupFailure, parseInventoryEntry } from '@proanima/arkvory-domain';
import type { ExcludedTable, InventoryEntry } from '@proanima/arkvory-domain';
import type { CaptureLease, SnapshotSession, SnapshotSource } from '@proanima/arkvory-application';
import { SCHEMA_VERSION } from './schema-version.js';
import {
  excludedTables,
  exportedTable,
  exportedTables,
  presentTablesQuery,
  quoteIdentifier,
  unregisteredTables,
} from './backup-tables.js';

export interface SnapshotOptions {
  /** Waiting for a conflicting DDL lock before T is refused after this time. */
  readonly lockTimeoutMs: number;
  /** PostgreSQL ends the snapshot when the process stalls between statements this long. */
  readonly idleTimeoutMs: number;
  readonly statementTimeoutMs: number;
  readonly fetchRows: number;
  readonly maxRowCharacters: number;
}
export const defaultSnapshotOptions: SnapshotOptions = {
  lockTimeoutMs: 30000,
  idleTimeoutMs: 600000,
  statementTimeoutMs: 300000,
  fetchRows: 500,
  maxRowCharacters: 16 * 1024 * 1024,
};

function sqlState(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
}

/**
 * Snapshot T: one REPEATABLE READ READ ONLY transaction. LOCK TABLE runs before the first query
 * (it does not take the transaction snapshot), so DDL that committed earlier is visible and no
 * DDL can rewrite an exported table until the export ends. pg_export_snapshot() records the
 * snapshot identity in the manifest; inventory and every table are read from this snapshot.
 */
export class PostgresSnapshotSource implements SnapshotSource {
  constructor(
    private readonly pool: Pool,
    private readonly options: SnapshotOptions = defaultSnapshotOptions,
  ) {
    const values = Object.values(options);
    if (!values.every((value) => Number.isSafeInteger(value) && value > 0))
      throw new BackupFailure('invalid_argument', 'Invalid snapshot options');
  }

  async open(lease: CaptureLease): Promise<SnapshotSession> {
    lease.throwIfAborted();
    const client = await this.pool.connect();
    // An idle-in-transaction session can be terminated between statements; without a listener
    // the driver's 'error' event would crash the process instead of failing the next statement.
    const lost = { value: false };
    client.on('error', () => {
      lost.value = true;
    });
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      // SET and LOCK are utility statements: neither establishes the snapshot.
      const { lockTimeoutMs, idleTimeoutMs, statementTimeoutMs } = this.options;
      await client.query(`SET LOCAL lock_timeout = ${String(lockTimeoutMs)}`);
      await client.query(
        `SET LOCAL idle_in_transaction_session_timeout = ${String(idleTimeoutMs)}`,
      );
      await client.query(`SET LOCAL statement_timeout = ${String(statementTimeoutMs)}`);
      await client.query(
        `LOCK TABLE ${exportedTables.map((table) => quoteIdentifier(table.name)).join(', ')} IN ACCESS SHARE MODE`,
      );
      const head = await client.query<{
        exported: string;
        taken_at: Date;
        schema: number | null;
        server: number;
        storage: string | null;
        pending: number;
      }>(`SELECT pg_export_snapshot() AS exported, clock_timestamp() AS taken_at,
          (SELECT max(version) FROM arkvory_migrations) AS schema,
          current_setting('server_version_num')::integer AS server,
          (SELECT storage_id::text FROM arkvory_storage_identity WHERE singleton) AS storage,
          (SELECT count(*)::integer FROM arkvory_uploads WHERE status='pending') AS pending`);
      const row = head.rows[0];
      if (row?.schema !== SCHEMA_VERSION)
        throw new BackupFailure('schema_mismatch', 'Database schema differs from this release');
      if (!row.storage) throw new BackupFailure('storage_mismatch', 'Database has no storage id');
      const present = await client.query<{ name: string }>(presentTablesQuery);
      const unknown = unregisteredTables(present.rows.map((table) => table.name));
      if (unknown.length)
        throw new BackupFailure('unknown_table', `Unregistered table: ${unknown.join(', ')}`);
      return new PostgresSnapshot(client, this.options, lost, {
        takenAt: row.taken_at.toISOString(),
        exportedId: row.exported,
        schemaVersion: row.schema,
        postgresMajor: Math.floor(row.server / 10000),
        sourceInstanceId: row.storage,
        pendingUploads: row.pending,
      });
    } catch (error) {
      client.release(true);
      if (error instanceof BackupFailure) throw error;
      const state = sqlState(error);
      if (state === '42P01')
        throw new BackupFailure('schema_mismatch', 'Exported table is missing', { cause: error });
      if (state === '55P03')
        throw new BackupFailure('busy', 'Schema change holds an exported table', { cause: error });
      throw new BackupFailure('snapshot_lost', 'Snapshot could not be opened', { cause: error });
    }
  }
}

interface SnapshotFacts {
  readonly takenAt: string;
  readonly exportedId: string;
  readonly schemaVersion: number;
  readonly postgresMajor: number;
  readonly sourceInstanceId: string;
  readonly pendingUploads: number;
}

class PostgresSnapshot implements SnapshotSession {
  readonly takenAt: string;
  readonly exportedId: string;
  readonly schemaVersion: number;
  readonly postgresMajor: number;
  readonly sourceInstanceId: string;
  readonly pendingUploads: number;
  readonly tables = exportedTables.map((table) => table.name);
  readonly excludedTables: readonly ExcludedTable[] = excludedTables;
  private finished = false;
  private broken = false;

  constructor(
    private readonly client: PoolClient,
    private readonly options: SnapshotOptions,
    private readonly lost: { readonly value: boolean },
    facts: SnapshotFacts,
  ) {
    this.takenAt = facts.takenAt;
    this.exportedId = facts.exportedId;
    this.schemaVersion = facts.schemaVersion;
    this.postgresMajor = facts.postgresMajor;
    this.sourceInstanceId = facts.sourceInstanceId;
    this.pendingUploads = facts.pendingUploads;
  }

  /** A failed statement ends T for good: an exported snapshot cannot be resumed. */
  private async query<R extends QueryResultRow>(text: string, values?: unknown[]): Promise<R[]> {
    if (this.lost.value) this.broken = true;
    if (this.finished || this.broken)
      throw new BackupFailure('snapshot_lost', 'Snapshot is no longer open');
    try {
      return (await this.client.query<R>(text, values)).rows;
    } catch (error) {
      this.broken = true;
      throw new BackupFailure('snapshot_lost', 'Snapshot transaction failed', { cause: error });
    }
  }

  async inventory(after: string | undefined, limit: number): Promise<readonly InventoryEntry[]> {
    const rows = await this.query<{ id: string; size: string; sha256: string | null }>(
      `SELECT id::text AS id, size::text AS size, descriptor->>'sha256' AS sha256
       FROM arkvory_uploads WHERE status='available' AND ($1::uuid IS NULL OR id>$1::uuid)
       ORDER BY id LIMIT $2`,
      [after ?? null, limit],
    );
    return rows.map((row) =>
      parseInventoryEntry({ id: row.id, size: row.size, sha256: row.sha256 }),
    );
  }

  async *rows(name: string): AsyncIterable<string> {
    const table = exportedTable(name);
    const order = table.key.map(quoteIdentifier).join(', ');
    await this.query(
      `DECLARE arkvory_backup_rows NO SCROLL CURSOR FOR
       SELECT row_to_json(t)::text AS line FROM ${quoteIdentifier(table.name)} t ORDER BY ${order}`,
    );
    let complete = false;
    try {
      for (;;) {
        const batch = await this.query<{ line: string }>(
          `FETCH ${String(this.options.fetchRows)} FROM arkvory_backup_rows`,
        );
        if (!batch.length) break;
        for (const row of batch) {
          if (row.line.length > this.options.maxRowCharacters)
            throw new BackupFailure('capture_too_large', 'Row exceeds the export limit');
          yield row.line;
        }
      }
      complete = true;
    } finally {
      // An abandoned cursor must not leak into the next table of the same transaction.
      if (!this.broken && !this.finished)
        await this.query('CLOSE arkvory_backup_rows').catch((error: unknown) => {
          if (complete) throw error;
        });
    }
  }

  async close(): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    if (this.broken || this.lost.value) {
      this.client.release(true);
      return;
    }
    try {
      await this.client.query('COMMIT');
      this.client.release();
    } catch (error) {
      this.client.release(true);
      throw new BackupFailure('snapshot_lost', 'Snapshot could not be closed', { cause: error });
    }
  }
}
