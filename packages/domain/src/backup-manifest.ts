import { requireId } from './artifact.js';
import { MAX_OBJECT_BYTES } from './object-size.js';
import { BackupFailure } from './backup.js';

/*
 * Vault documents are external input: a restore may read a vault written by another host or
 * tampered with. Every value stays `unknown` until these parsers accept it. File locations are
 * never taken from a document; they are derived from validated identifiers and table names.
 */
export const VAULT_FORMAT = 'arkvory-vault';
/** Plain vault (ADR 0054). */
export const VAULT_FORMAT_VERSION = 1;
/** Encrypted vault (ADR 0070): AES-256-GCM files and key slots. */
export const ENCRYPTED_VAULT_FORMAT_VERSION = 2;
export const VAULT_ENCRYPTION = 'aes-256-gcm-v1';
export const POINT_FORMAT = 'arkvory-backup-point';
export const POINT_FORMAT_VERSION = 1;
export const INVENTORY_FILE = 'inventory.ndjson';
export const MAX_POINT_TABLES = 128;
const tableName = /^arkvory_[a-z0-9_]{1,55}$/;
const sha256 = /^[a-f0-9]{64}$/;
const decimal = /^(0|[1-9][0-9]{0,18})$/;
const isoTime = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,6})?Z$/;
const snapshotId = /^[0-9A-F]{1,16}-[0-9A-F]{1,16}-[0-9]{1,10}$/;
const releaseVersion = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/;
const commitPattern = /^[a-f0-9]{40}$/;
const reasonPattern = /^[a-z0-9 ,.;:()/_'-]{1,160}$/;

export interface VaultIdentity {
  readonly format: typeof VAULT_FORMAT;
  readonly version: typeof VAULT_FORMAT_VERSION | typeof ENCRYPTED_VAULT_FORMAT_VERSION;
  readonly vaultId: string;
  readonly createdAt: string;
  /**
   * 'none': plain files, the volume itself must be encrypted and access-controlled (ADR 0054).
   * Otherwise the content, the catalog and the manifests are encrypted (ADR 0070).
   */
  readonly encryption: 'none' | typeof VAULT_ENCRYPTION;
}
export interface InventoryEntry {
  readonly id: string;
  readonly size: number;
  readonly sha256: string;
}
export interface PointFile {
  readonly sha256: string;
  /** Decimal string: byte counts are not bounded by the JSON safe-integer range. */
  readonly bytes: string;
}
export interface PointTable extends PointFile {
  readonly name: string;
  readonly rows: number;
}
export interface ExcludedTable {
  readonly name: string;
  readonly reason: string;
}
export interface BackupManifest {
  readonly format: typeof POINT_FORMAT;
  readonly version: typeof POINT_FORMAT_VERSION;
  readonly pointId: string;
  readonly jobId: string;
  readonly vaultId: string;
  readonly sourceInstanceId: string;
  readonly release: { readonly version: string; readonly commit: string | null };
  readonly schemaVersion: number;
  readonly postgresMajor: number;
  readonly snapshot: { readonly takenAt: string; readonly exportedId: string };
  readonly startedAt: string;
  readonly completedAt: string;
  readonly inventory: PointFile & { readonly count: number; readonly contentBytes: string };
  readonly tables: readonly PointTable[];
  readonly excludedTables: readonly ExcludedTable[];
  /** Unfinished uploads at T; their rows are kept, a restore cancels them. */
  readonly pendingUploads: number;
}
/** Written last inside a staged point; binds the directory to one exact manifest. */
export interface CommitRecord {
  readonly pointId: string;
  readonly manifestSha256: string;
}

function invalid(message: string): BackupFailure {
  return new BackupFailure('invalid_manifest', message);
}
function fields(value: unknown, keys: readonly string[], what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw invalid(`${what} must be an object`);
  const row = Object.fromEntries(Object.entries(value));
  const names = Object.keys(row);
  if (names.length !== keys.length || names.some((name) => !keys.includes(name)))
    throw invalid(`${what} has unexpected or missing fields`);
  return row;
}
function text(value: unknown, pattern: RegExp, what: string): string {
  if (typeof value !== 'string' || !pattern.test(value)) throw invalid(`Invalid ${what}`);
  return value;
}
function count(value: unknown, what: string, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > maximum)
    throw invalid(`Invalid ${what}`);
  return value;
}
function identifier(value: unknown, what: string): string {
  if (typeof value !== 'string') throw invalid(`Invalid ${what}`);
  try {
    return requireId(value);
  } catch {
    throw invalid(`Invalid ${what}`);
  }
}
function timestamp(value: unknown, what: string): string {
  const result = text(value, isoTime, what);
  if (!Number.isFinite(Date.parse(result))) throw invalid(`Invalid ${what}`);
  return result;
}

/** Parses one vault document or NDJSON line; the result is still unvalidated. */
export function parseVaultJson(source: string): unknown {
  try {
    return JSON.parse(source);
  } catch {
    throw invalid('Vault document is not valid JSON');
  }
}

/** The only accepted location of a table export inside a point directory. */
export function tableFileName(name: string): string {
  if (!tableName.test(name)) throw invalid('Invalid table name');
  return `tables/${name}.ndjson`;
}

export function parseVaultIdentity(value: unknown): VaultIdentity {
  const row = fields(value, ['format', 'version', 'vaultId', 'createdAt', 'encryption'], 'vault');
  if (row['format'] !== VAULT_FORMAT) throw invalid('Unsupported vault format');
  // The version and the encryption go together: no other pair is a vault of this code.
  const plain = row['version'] === VAULT_FORMAT_VERSION && row['encryption'] === 'none';
  const encrypted =
    row['version'] === ENCRYPTED_VAULT_FORMAT_VERSION && row['encryption'] === VAULT_ENCRYPTION;
  if (!plain && !encrypted) throw invalid('Unsupported vault format');
  return {
    format: VAULT_FORMAT,
    version: plain ? VAULT_FORMAT_VERSION : ENCRYPTED_VAULT_FORMAT_VERSION,
    vaultId: identifier(row['vaultId'], 'vault id'),
    createdAt: timestamp(row['createdAt'], 'vault creation time'),
    encryption: plain ? 'none' : VAULT_ENCRYPTION,
  };
}

export function parseInventoryEntry(value: unknown): InventoryEntry {
  const row = fields(value, ['id', 'size', 'sha256'], 'inventory entry');
  const size = Number(text(row['size'], decimal, 'inventory size'));
  if (!Number.isSafeInteger(size) || size > MAX_OBJECT_BYTES) throw invalid('Invalid object size');
  return {
    id: identifier(row['id'], 'inventory id'),
    size,
    sha256: text(row['sha256'], sha256, 'inventory digest'),
  };
}

/** One inventory NDJSON line; sizes are decimal strings like every other byte count. */
export function inventoryLine(entry: InventoryEntry): string {
  return JSON.stringify({ id: entry.id, size: String(entry.size), sha256: entry.sha256 });
}

export function parseCommitRecord(value: unknown): CommitRecord {
  const row = fields(value, ['pointId', 'manifestSha256'], 'commit record');
  return {
    pointId: identifier(row['pointId'], 'point id'),
    manifestSha256: text(row['manifestSha256'], sha256, 'manifest digest'),
  };
}

function pointFile(row: Record<string, unknown>, what: string): PointFile {
  return { sha256: text(row['sha256'], sha256, what), bytes: text(row['bytes'], decimal, what) };
}
function parseTables(value: unknown): PointTable[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_POINT_TABLES)
    throw invalid('Invalid table list');
  const seen = new Set<string>();
  return value.map((item: unknown) => {
    const row = fields(item, ['name', 'file', 'rows', 'sha256', 'bytes'], 'table');
    const name = text(row['name'], tableName, 'table name');
    // A traversal or absolute path can only arrive here, and is refused before any file access.
    if (row['file'] !== tableFileName(name) || seen.has(name)) throw invalid('Invalid table file');
    seen.add(name);
    return { name, rows: count(row['rows'], 'row count'), ...pointFile(row, 'table digest') };
  });
}
function parseExcluded(value: unknown): ExcludedTable[] {
  if (!Array.isArray(value) || value.length > MAX_POINT_TABLES)
    throw invalid('Invalid excluded table list');
  return value.map((item: unknown) => {
    const row = fields(item, ['name', 'reason'], 'excluded table');
    return {
      name: text(row['name'], tableName, 'excluded table name'),
      reason: text(row['reason'], reasonPattern, 'exclusion reason'),
    };
  });
}

const manifestKeys = [
  'format',
  'version',
  'pointId',
  'jobId',
  'vaultId',
  'sourceInstanceId',
  'release',
  'schemaVersion',
  'postgresMajor',
  'snapshot',
  'startedAt',
  'completedAt',
  'inventory',
  'tables',
  'excludedTables',
  'pendingUploads',
];

export function parseBackupManifest(value: unknown): BackupManifest {
  const row = fields(value, manifestKeys, 'manifest');
  if (row['format'] !== POINT_FORMAT || row['version'] !== POINT_FORMAT_VERSION)
    throw invalid('Unsupported backup point format');
  const release = fields(row['release'], ['version', 'commit'], 'release');
  const snapshot = fields(row['snapshot'], ['takenAt', 'exportedId'], 'snapshot');
  const inventory = fields(
    row['inventory'],
    ['file', 'count', 'contentBytes', 'sha256', 'bytes'],
    'inventory',
  );
  if (inventory['file'] !== INVENTORY_FILE) throw invalid('Invalid inventory file');
  const tables = parseTables(row['tables']);
  const excludedTables = parseExcluded(row['excludedTables']);
  if (excludedTables.some((excluded) => tables.some((table) => table.name === excluded.name)))
    throw invalid('A table cannot be both exported and excluded');
  return {
    format: POINT_FORMAT,
    version: POINT_FORMAT_VERSION,
    pointId: identifier(row['pointId'], 'point id'),
    jobId: identifier(row['jobId'], 'job id'),
    vaultId: identifier(row['vaultId'], 'vault id'),
    sourceInstanceId: identifier(row['sourceInstanceId'], 'source instance id'),
    release: {
      version: text(release['version'], releaseVersion, 'release version'),
      commit: release['commit'] === null ? null : text(release['commit'], commitPattern, 'commit'),
    },
    schemaVersion: count(row['schemaVersion'], 'schema version', 100000),
    postgresMajor: count(row['postgresMajor'], 'PostgreSQL version', 1000),
    snapshot: {
      takenAt: timestamp(snapshot['takenAt'], 'snapshot time'),
      exportedId: text(snapshot['exportedId'], snapshotId, 'snapshot id'),
    },
    startedAt: timestamp(row['startedAt'], 'start time'),
    completedAt: timestamp(row['completedAt'], 'completion time'),
    inventory: {
      count: count(inventory['count'], 'inventory count'),
      contentBytes: text(inventory['contentBytes'], decimal, 'content bytes'),
      ...pointFile(inventory, 'inventory digest'),
    },
    tables,
    excludedTables,
    pendingUploads: count(row['pendingUploads'], 'pending uploads'),
  };
}

/** Wire form of a manifest, the inverse of parseBackupManifest. */
export function manifestDocument(manifest: BackupManifest): Record<string, unknown> {
  return {
    ...manifest,
    inventory: { file: INVENTORY_FILE, ...manifest.inventory },
    tables: manifest.tables.map((table) => ({
      name: table.name,
      file: tableFileName(table.name),
      rows: table.rows,
      sha256: table.sha256,
      bytes: table.bytes,
    })),
  };
}
