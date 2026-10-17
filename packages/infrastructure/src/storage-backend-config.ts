import { readFile, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { DEFAULT_STORAGE_BACKEND } from '@proanima/arkvory-domain';
import { LocalBlobStore } from './local-blobs.js';
import { StorageBackends } from './storage-backends.js';
import { containsPath } from './vault-paths.js';

/**
 * One more `local-storage` instance (ADR 0083, N11), for example a second volume. The core's
 * own storage is always `default` at ARKVORY_DATA_DIR and is not configured here.
 */
export interface LocalStorageSettings {
  readonly id: string;
  /** Absolute directory of the instance; it must not contain or lie inside another storage. */
  readonly directory: string;
  readonly enabled: boolean;
  readonly mode: 'full' | 'read-only';
  readonly acceptsWrites: boolean;
  /** Free space kept on the volume; ARKVORY_STORAGE_RESERVE_BYTES when absent. */
  readonly reserveBytes: number | undefined;
}

const FORMAT = 1;
const MAX_BACKENDS = 16;
const MAX_FILE_BYTES = 64 * 1024;
/** `local-storage` ids have no dot: `<module>.<name>` belongs to storage modules. */
const LOCAL_ID = /^[a-z][a-z0-9-]{0,63}$/;
const NAME = 'ARKVORY_STORAGE_BACKENDS_FILE';

/** Messages name the field, never a value: the file holds paths of the installation. */
function fail(field: string): never {
  throw new Error(`Invalid ${NAME}: ${field}`);
}

function fields(value: unknown, path: string, known: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(path || '/');
  const row: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  if (Object.keys(row).some((key) => !known.includes(key))) fail(`unknown field in ${path || '/'}`);
  return row;
}

function flag(row: Record<string, unknown>, key: string, path: string, fallback: boolean) {
  const value = row[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') fail(`${path}/${key}`);
  return value;
}

function settings(id: string, value: unknown): LocalStorageSettings {
  const path = `/backends/${id}`;
  const row = fields(value, path, [
    'directory',
    'enabled',
    'mode',
    'acceptsWrites',
    'reserveBytes',
  ]);
  const { directory, mode, reserveBytes } = row;
  if (
    typeof directory !== 'string' ||
    !isAbsolute(directory) ||
    directory.length > 1024 ||
    directory.includes('\0')
  )
    fail(`${path}/directory`);
  if (mode !== undefined && mode !== 'full' && mode !== 'read-only') fail(`${path}/mode`);
  if (
    reserveBytes !== undefined &&
    (typeof reserveBytes !== 'number' || !Number.isSafeInteger(reserveBytes) || reserveBytes < 0)
  )
    fail(`${path}/reserveBytes`);
  return {
    id,
    directory,
    enabled: flag(row, 'enabled', path, true),
    mode: mode ?? 'full',
    acceptsWrites: flag(row, 'acceptsWrites', path, true),
    reserveBytes,
  };
}

/**
 * `{"format": 1, "backends": {"volume-2": {"directory": "/srv/arkvory-2"}}}`; `enabled`,
 * `mode` (`full` | `read-only`), `acceptsWrites` and `reserveBytes` are optional. Directories
 * may not contain each other or the data directory: one file would then belong to two storages.
 */
export function parseStorageBackends(
  value: unknown,
  dataDirectory: string,
): readonly LocalStorageSettings[] {
  const document = fields(value, '', ['format', 'backends']);
  if (document['format'] !== FORMAT) fail('/format');
  const list = document['backends'];
  if (list === undefined) return [];
  if (typeof list !== 'object' || list === null || Array.isArray(list)) fail('/backends');
  const entries = Object.entries(Object.fromEntries(Object.entries(list)));
  if (entries.length > MAX_BACKENDS) fail('/backends: too many backends');
  const backends = entries.map(([id, entry]) => {
    if (!LOCAL_ID.test(id) || id === DEFAULT_STORAGE_BACKEND) fail('/backends: backend id');
    return settings(id, entry);
  });
  const roots = [dataDirectory, ...backends.map((backend) => backend.directory)];
  roots.forEach((outer, i) => {
    roots.forEach((inner, j) => {
      if (i < j && (containsPath(outer, inner) || containsPath(inner, outer)))
        fail(`/backends/${backends[j - 1]?.id ?? ''}/directory: overlaps another storage`);
    });
  });
  return backends;
}

/** No file: the installation has only its core storage, as before placement existed. */
export async function readStorageBackends(
  file: string | undefined,
  dataDirectory: string,
): Promise<readonly LocalStorageSettings[]> {
  if (file === undefined || file === '') return [];
  if (!isAbsolute(file)) throw new Error(`${NAME} must be an absolute path`);
  let text: string;
  try {
    if ((await stat(file)).size > MAX_FILE_BYTES) fail('file too large');
    text = await readFile(file, 'utf8');
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(`Invalid ${NAME}`)) throw error;
    throw new Error(`${NAME} cannot be read`, { cause: error });
  }
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid ${NAME}: JSON`, { cause: error });
  }
  return parseStorageBackends(document, dataDirectory);
}

/**
 * The storages of a process: `default` at the data directory and every configured instance,
 * each a `LocalBlobStore` with its own reserve. Nothing is opened here.
 */
export function localStorageBackends(
  dataDirectory: string,
  reserveBytes: number,
  configured: readonly LocalStorageSettings[],
  rootMode?: number,
): StorageBackends {
  const local = (directory: string, reserve: number) => {
    const store = new LocalBlobStore(directory, reserve, rootMode);
    return { blobs: store, lifecycle: store };
  };
  return new StorageBackends([
    {
      id: DEFAULT_STORAGE_BACKEND,
      ...local(dataDirectory, reserveBytes),
      mode: 'full',
      acceptsWrites: true,
      enabled: true,
    },
    ...configured.map((backend) => ({
      id: backend.id,
      ...local(backend.directory, backend.reserveBytes ?? reserveBytes),
      mode: backend.mode,
      acceptsWrites: backend.acceptsWrites,
      enabled: backend.enabled,
    })),
  ]);
}
