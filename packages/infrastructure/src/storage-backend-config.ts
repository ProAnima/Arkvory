import { stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { DEFAULT_STORAGE_BACKEND } from '@proanima/arkvory-domain';
import { ModuleConfigError } from '@proanima/arkvory-extension-api';
import type { ModuleJson } from '@proanima/arkvory-extension-api';
import { LocalBlobStore } from './local-blobs.js';
import { StorageBackends } from './storage-backends.js';
import { containsPath } from './vault-paths.js';
import { readModuleSelections } from './module-selection.js';
import type { ModuleSelection, ModuleSelections } from './module-selection.js';

/** Id of the built-in storage module (ADR 0079, section 8). */
export const LOCAL_STORAGE_MODULE = 'local-storage';

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

export interface LocalStorageConfig {
  readonly instances: readonly LocalStorageSettings[];
}

const MAX_INSTANCES = 16;
/** `local-storage` ids have no dot: `<module>.<name>` belongs to storage modules. */
const LOCAL_ID = /^[a-z][a-z0-9-]{0,63}$/;

function fields(value: unknown, path: string, known: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new ModuleConfigError('type', path);
  const row: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  const unknown = Object.keys(row).find((key) => !known.includes(key));
  if (unknown !== undefined)
    throw new ModuleConfigError(
      'unknown_field',
      LOCAL_ID.test(unknown) ? `${path}/${unknown}` : path,
    );
  return row;
}

function flag(row: Record<string, unknown>, key: string, path: string, fallback: boolean) {
  const value = row[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new ModuleConfigError('type', `${path}/${key}`);
  return value;
}

function instance(id: string, value: unknown): LocalStorageSettings {
  const path = `/instances/${id}`;
  const row = fields(value, path, [
    'directory',
    'enabled',
    'mode',
    'acceptsWrites',
    'reserveBytes',
  ]);
  const { directory, mode, reserveBytes } = row;
  if (directory === undefined) throw new ModuleConfigError('required', `${path}/directory`);
  if (
    typeof directory !== 'string' ||
    !isAbsolute(directory) ||
    directory.length > 1024 ||
    directory.includes('\0')
  )
    throw new ModuleConfigError('format', `${path}/directory`);
  if (mode !== undefined && mode !== 'full' && mode !== 'read-only')
    throw new ModuleConfigError('invalid', `${path}/mode`);
  if (
    reserveBytes !== undefined &&
    (typeof reserveBytes !== 'number' || !Number.isSafeInteger(reserveBytes) || reserveBytes < 0)
  )
    throw new ModuleConfigError('range', `${path}/reserveBytes`);
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
 * The settings of `local-storage` in ARKVORY_MODULES_FILE:
 * `{"instances": {"volume-2": {"directory": "/srv/arkvory-2"}}}` with optional `enabled`,
 * `mode` (`full` | `read-only`), `acceptsWrites` and `reserveBytes`. No settings: only the
 * core's storage `default` at ARKVORY_DATA_DIR, as before placement existed.
 */
export function parseLocalStorageConfig(input: unknown): LocalStorageConfig {
  if (input === undefined) return { instances: [] };
  const row = fields(input, '', ['instances']);
  const list = row['instances'];
  if (list === undefined) return { instances: [] };
  if (typeof list !== 'object' || list === null || Array.isArray(list))
    throw new ModuleConfigError('type', '/instances');
  const entries = Object.entries(Object.fromEntries(Object.entries(list)));
  if (entries.length > MAX_INSTANCES) throw new ModuleConfigError('length', '/instances');
  return {
    instances: entries.map(([id, entry]) => {
      if (!LOCAL_ID.test(id) || id === DEFAULT_STORAGE_BACKEND)
        throw new ModuleConfigError('format', '/instances');
      return instance(id, entry);
    }),
  };
}

/**
 * What every process of the installation must agree on: which storages exist and how they
 * take writes. Directories and reserves stay out: they are where this host mounts a volume.
 */
export function describeLocalStorageConfig(config: LocalStorageConfig): ModuleJson {
  if (config.instances.length === 0) return {};
  return {
    instances: Object.fromEntries(
      config.instances.map((entry) => [
        entry.id,
        { enabled: entry.enabled, mode: entry.mode, acceptsWrites: entry.acceptsWrites },
      ]),
    ),
  };
}

/**
 * The instances of `local-storage` for this host. Directories may not contain each other or the
 * data directory: one file would then belong to two storages. Messages name the field only.
 */
export function localStorageSettings(
  selection: ModuleSelection | undefined,
  dataDirectory: string,
): readonly LocalStorageSettings[] {
  let config: LocalStorageConfig;
  try {
    config = parseLocalStorageConfig(selection?.config);
  } catch (error) {
    if (!(error instanceof ModuleConfigError)) throw error;
    throw new Error(
      `Invalid ARKVORY_MODULES_FILE: ${error.code} /modules/${LOCAL_STORAGE_MODULE}/config${error.path}`,
      { cause: error },
    );
  }
  const roots = [dataDirectory, ...config.instances.map((entry) => entry.directory)];
  roots.forEach((outer, i) => {
    roots.forEach((inner, j) => {
      if (i < j && (containsPath(outer, inner) || containsPath(inner, outer)))
        throw new Error(
          `Invalid ARKVORY_MODULES_FILE: overlapping /modules/${LOCAL_STORAGE_MODULE}/config/instances/${config.instances[j - 1]?.id ?? ''}/directory`,
        );
    });
  });
  return config.instances;
}

/**
 * In a cluster (ADR 0072) one replicated file system moves between the servers: a volume on
 * another disk would stay behind on the failed server, its files unavailable or lost. Every
 * volume must be a directory on the file system of the data directory; a volume that is
 * missing or elsewhere stops the start. `device` is the file system of a path (tests).
 */
export async function requireReplicatedVolumes(
  dataDirectory: string,
  configured: readonly LocalStorageSettings[],
  device: (path: string) => Promise<number> = async (path) => (await stat(path)).dev,
): Promise<void> {
  const replicated = await device(dataDirectory);
  for (const volume of configured) {
    const own = await device(volume.directory).catch(() => null);
    if (own !== replicated)
      throw new Error(
        `Invalid ARKVORY_MODULES_FILE: not on the replicated volume /modules/${LOCAL_STORAGE_MODULE}/config/instances/${volume.id}/directory`,
      );
  }
}

/** The instances from a modules file, for processes that read it themselves. */
export async function readLocalStorageSettings(
  modulesFile: string | undefined,
  dataDirectory: string,
  selections?: ModuleSelections,
): Promise<readonly LocalStorageSettings[]> {
  const chosen = selections ?? (await readModuleSelections(modulesFile));
  return localStorageSettings(chosen.get(LOCAL_STORAGE_MODULE), dataDirectory);
}

export interface StorageBackendOptions {
  /** Mode of the roots a restore creates (0700). */
  readonly rootMode?: number;
  /**
   * Only a restore target: `initialize` may create the directory of a volume. Otherwise it
   * must exist, so the first start of a volume that is not mounted fails instead of writing
   * beneath its mount point (ADR 0083, N11).
   */
  readonly createVolumeRoots?: boolean;
  /** Free inodes every volume keeps (ARKVORY_STORAGE_RESERVE_INODES, ADR 0083, N6). */
  readonly reserveInodes?: number;
}

/**
 * The storages of a process: `default` at the data directory and every configured instance,
 * each a `LocalBlobStore` with its own reserve. Nothing is opened here.
 */
export function localStorageBackends(
  dataDirectory: string,
  reserveBytes: number,
  configured: readonly LocalStorageSettings[],
  options: StorageBackendOptions = {},
): StorageBackends {
  const { rootMode, reserveInodes } = options;
  const volume = { createRoot: options.createVolumeRoots ?? false };
  const core = new LocalBlobStore(dataDirectory, reserveBytes, rootMode, undefined, reserveInodes);
  return new StorageBackends([
    {
      id: DEFAULT_STORAGE_BACKEND,
      blobs: core,
      lifecycle: core,
      mode: 'full',
      acceptsWrites: true,
      enabled: true,
    },
    ...configured.map((backend) => {
      const store = new LocalBlobStore(
        backend.directory,
        backend.reserveBytes ?? reserveBytes,
        rootMode,
        volume,
        reserveInodes,
      );
      return {
        id: backend.id,
        blobs: store,
        lifecycle: store,
        mode: backend.mode,
        acceptsWrites: backend.acceptsWrites,
        enabled: backend.enabled,
      };
    }),
  ]);
}
