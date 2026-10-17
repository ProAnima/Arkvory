import { readFile } from 'node:fs/promises';
import { MODULE_ID_PATTERN } from '@proanima/arkvory-extension-api';

/** The operator's choice for one module (ADR 0079, section 3). */
export interface ModuleSelection {
  readonly enabled: boolean;
  /** The module's own settings, untrusted until its `parseConfig`; undefined when absent. */
  readonly config: unknown;
}

/** Choices by module id; a module not named keeps its default: enabled, no settings. */
export type ModuleSelections = ReadonlyMap<string, ModuleSelection>;

const FORMAT = 1;
const MAX_MODULES = 256;
const MAX_FILE_BYTES = 1024 * 1024;

/**
 * Messages name the JSON Pointer of the field, never a value: settings may hold paths to secret
 * files. An id that is not a module id is not echoed either.
 */
function fail(path: string): never {
  throw new Error(`Invalid ARKVORY_MODULES_FILE: ${path}`);
}

function fields(value: unknown, path: string, known: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(path || '/');
  const row: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  const unknown = Object.keys(row).find((key) => !known.includes(key));
  if (unknown !== undefined)
    fail(MODULE_ID_PATTERN.test(unknown) ? `${path}/${unknown}: unknown field` : `${path}: field`);
  return row;
}

function selection(id: string, value: unknown): ModuleSelection {
  const path = `/modules/${id}`;
  const row = fields(value, path, ['enabled', 'config']);
  const enabled = row['enabled'];
  if (typeof enabled !== 'boolean') fail(`${path}/enabled`);
  return { enabled, config: row['config'] };
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
 * No file configured: every built-in module with its defaults, as before modules existed. A
 * configured file that cannot be read or parsed stops the start before storage is claimed.
 */
export async function readModuleSelections(file: string | undefined): Promise<ModuleSelections> {
  if (file === undefined || file === '') return new Map();
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    throw new Error('ARKVORY_MODULES_FILE cannot be read', { cause: error });
  }
  if (text.length > MAX_FILE_BYTES) fail('file too large');
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch (error) {
    throw new Error('Invalid ARKVORY_MODULES_FILE: JSON', { cause: error });
  }
  return parseModuleSelections(document);
}
