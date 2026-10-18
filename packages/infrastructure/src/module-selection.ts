import { open, type FileHandle } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { MODULE_ID_PATTERN } from '@proanima/arkvory-extension-api';
import type { ModuleResources } from '@proanima/arkvory-extension-api';

/** The operator's choice for one module (ADR 0079, section 3). */
export interface ModuleSelection {
  readonly enabled: boolean;
  /** The module's own settings, untrusted until its `parseConfig`; undefined when absent. */
  readonly config: unknown;
  /**
   * The data directory the operator approves (ADR 0083, N6), replacing what the manifest asks;
   * absent keeps the manifest's request.
   */
  readonly resources?: ModuleResources;
}

/** Choices by module id; a module not named keeps its default: enabled, no settings. */
export type ModuleSelections = ReadonlyMap<string, ModuleSelection>;

const FORMAT = 1;
const MAX_MODULES = 256;
const MAX_FILE_BYTES = 1024 * 1024;

/**
 * Messages name the JSON Pointer of the field, never a value: settings may hold paths to secret
 * files. An id that is not a module id is not echoed either. Nothing follows a pointer after a
 * colon: `startupReason` redacts the word after `token:` or `key:`, and a field named so must
 * still reach the log.
 */
function fail(path: string): never {
  throw new Error(`Invalid ARKVORY_MODULES_FILE: ${path}`);
}

function fields(value: unknown, path: string, known: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(path || '/');
  const row: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  const unknown = Object.keys(row).find((key) => !known.includes(key));
  if (unknown !== undefined)
    fail(
      MODULE_ID_PATTERN.test(unknown)
        ? `unknown field ${path}/${unknown}`
        : `unknown field in ${path || '/'}`,
    );
  return row;
}

const MAX_DATA_MIB = 1024 * 1024;
const MAX_DATA_FILES = 10_000_000;

function count(value: unknown, path: string, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max)
    fail(path);
  return value;
}

function resources(value: unknown, path: string): ModuleResources {
  const row = fields(value, path, ['dataMiB', 'dataFiles']);
  return {
    dataMiB: count(row['dataMiB'], `${path}/dataMiB`, MAX_DATA_MIB),
    dataFiles: count(row['dataFiles'], `${path}/dataFiles`, MAX_DATA_FILES),
  };
}

function selection(id: string, value: unknown): ModuleSelection {
  const path = `/modules/${id}`;
  const row = fields(value, path, ['enabled', 'config', 'resources']);
  const enabled = row['enabled'];
  if (typeof enabled !== 'boolean') fail(`${path}/enabled`);
  const approved = row['resources'];
  return {
    enabled,
    config: row['config'],
    ...(approved === undefined ? {} : { resources: resources(approved, `${path}/resources`) }),
  };
}

/** `{"format": 1, "modules": {"<id>": {"enabled": true, "config": {...}}}}`. */
export function parseModuleSelections(value: unknown): ModuleSelections {
  const document = fields(value, '', ['format', 'modules']);
  if (document['format'] !== FORMAT) fail('/format');
  const modules = document['modules'];
  if (modules === undefined) return new Map();
  if (typeof modules !== 'object' || modules === null || Array.isArray(modules)) fail('/modules');
  const list: Record<string, unknown> = Object.fromEntries(Object.entries(modules));
  const entries = Object.entries(list);
  if (entries.length > MAX_MODULES) fail('/modules: too many modules');
  return new Map(
    entries.map(([id, entry]) => {
      if (!MODULE_ID_PATTERN.test(id)) fail('/modules: module id');
      return [id, selection(id, entry)];
    }),
  );
}

/**
 * The file as UTF-8 text. It is read at most `MAX_FILE_BYTES + 1` bytes far, so a huge file or a
 * device never fills memory before it is refused.
 */
async function boundedText(file: string): Promise<string> {
  let handle: FileHandle;
  try {
    handle = await open(file, 'r');
  } catch (error) {
    throw new Error('ARKVORY_MODULES_FILE cannot be read', { cause: error });
  }
  try {
    const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
    let length = 0;
    for (;;) {
      const { bytesRead } = await handle
        .read(buffer, length, buffer.length - length, null)
        .catch((error: unknown) => {
          throw new Error('ARKVORY_MODULES_FILE cannot be read', { cause: error });
        });
      if (bytesRead === 0) return buffer.toString('utf8', 0, length);
      length += bytesRead;
      if (length > MAX_FILE_BYTES) fail('file too large');
    }
  } finally {
    await handle.close();
  }
}

/**
 * No file configured: every built-in module with its defaults, as before modules existed. A
 * configured file that cannot be read or parsed stops the start before storage is claimed. The
 * path is absolute: installed services start in the directory of the current release, where a
 * relative path would resolve and then be lost at the next update.
 */
export async function readModuleSelections(file: string | undefined): Promise<ModuleSelections> {
  if (file === undefined || file === '') return new Map();
  if (!isAbsolute(file)) throw new Error('ARKVORY_MODULES_FILE must be an absolute path');
  const text = await boundedText(file);
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch (error) {
    throw new Error('Invalid ARKVORY_MODULES_FILE: JSON', { cause: error });
  }
  return parseModuleSelections(document);
}
