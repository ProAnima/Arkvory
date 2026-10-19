import type { ComputeTask } from './compute.js';
import { parseProvidedCapability, parseRequiredCapability } from './capabilities.js';
import { MODULE_SOURCES, type ModuleSource } from './sources.js';
import { parseCaretRange, parseSemanticVersion } from './version.js';

/** The only manifest format this version reads. */
export const MODULE_MANIFEST_FORMAT = 1;

/**
 * Extension points this version of the contract knows (ADR 0079, section 5). A manifest may name
 * another one, written for a later version: it is read, and the plan refuses it only when the
 * module is enabled (`unknown_kind`, ADR 0083, section 2.2).
 */
export const MODULE_KINDS = [
  'protocol',
  'storage-backend',
  'backup-vault',
  'identity-provider',
  'event-sink',
  'transfer',
  // A module without an extension point of its own: it works through host services only.
  'service',
] as const;
export type ModuleKind = (typeof MODULE_KINDS)[number];

/** Processes a module runs in: the writer, read gateways, the worker and the backup agent. */
export const MODULE_ROLES = ['api', 'reader', 'worker', 'backup'] as const;
export type ModuleRole = (typeof MODULE_ROLES)[number];

/** What the core reads about a module before creating it; no code and no configuration. */
export interface ModuleManifest {
  readonly format: typeof MODULE_MANIFEST_FORMAT;
  /**
   * `MODULE_ID_PATTERN`: 2 to 32 lowercase letters, digits and single inner hyphens; unique within
   * an installation.
   */
  readonly id: string;
  /** Semver version of the module. */
  readonly version: string;
  /** Caret range of extension API versions the module works with, such as `^0.1.0`. */
  readonly extensionApi: string;
  /** `[a-z][a-z0-9-]{1,31}`: one of `MODULE_KINDS`, or a point of a later contract version. */
  readonly kind: string;
  /**
   * Who publishes the module, `[a-z][a-z0-9-]{1,31}`: `proanimastudio` for the core and its
   * signed modules. The loader matches it with the signing key; the plan does not.
   */
  readonly publisher: string;
  /** A core module is part of the free core and is never disabled. */
  readonly core: boolean;
  readonly roles: readonly ModuleRole[];
  /**
   * Services of the core the module uses (`HOST_SERVICES`); `context.services` holds only these.
   * Absent in a manifest means none.
   */
  readonly uses: readonly string[];
  readonly compute?: readonly ComputeTask[];
  /**
   * Capabilities the module needs from other enabled modules: `name@^1.2.0`, a caret range of the
   * value's contract (ADR 0083, N13). A bare `name` means `@^0.0.0`, for built-in modules only.
   */
  readonly requires: readonly string[];
  /** Capabilities the module uses when a provider is enabled, as `requires`; absent means none. */
  readonly optional: readonly string[];
  /**
   * Capabilities the module gives other modules, `name@1.4.0`; one provider per name. A bare
   * `name` means `@0.0.0`, for built-in modules only.
   */
  readonly provides: readonly string[];
  /**
   * Sources whose modules may use the values of `provides` beside modules of the same
   * `publisher`, who always may (ADR 0083, N13); absent means none.
   */
  readonly exposeTo: readonly ModuleSource[];
  /**
   * What the module asks of its data directory (service `data-directory`, ADR 0083, N6); the
   * operator approves or changes it in `ARKVORY_MODULES_FILE`. Null when absent.
   */
  readonly resources: ModuleResources | null;
  /** Path prefixes of the routes the module serves, each starting and ending with `/`. */
  readonly routePrefixes: readonly string[];
  /** Prefix of every metric the module publishes, or null for none. */
  readonly metricPrefix: string | null;
  /** Prefix of every table the module owns, or null for none. */
  readonly tablePrefix: string | null;
}

/** Requested size of the data directory, both areas together. */
export interface ModuleResources {
  /** Bytes in MiB, 0 to 1048576 (1 TiB). */
  readonly dataMiB: number;
  /** Regular files, 0 to 10000000. */
  readonly dataFiles: number;
}

export type ModuleManifestProblem =
  'type' | 'required' | 'unknown_field' | 'format' | 'duplicate' | 'unsupported_format';

/** A manifest that cannot be read. The message names the field, never the value. */
export class ModuleManifestError extends Error {
  override readonly name = 'ModuleManifestError';
  constructor(
    readonly code: ModuleManifestProblem,
    /** JSON Pointer of the field in the manifest; empty for the manifest itself. */
    readonly path: string,
  ) {
    super(`Invalid module manifest: ${code} at ${path === '' ? '/' : path}`);
  }
}

const FIELDS = [
  'format',
  'id',
  'version',
  'extensionApi',
  'kind',
  'publisher',
  'core',
  'roles',
  'uses',
  'compute',
  'requires',
  'optional',
  'provides',
  'exposeTo',
  'resources',
  'routePrefixes',
  'metricPrefix',
  'tablePrefix',
] as const;
/**
 * `[a-z][a-z0-9-]{1,31}` without a doubled or trailing hyphen. With hyphens written as `_`, the
 * names `arkvory_x_<id>__` of signed modules then never start one another (see plan-rules).
 */
export const MODULE_ID_PATTERN = /^(?=.{2,32}$)[a-z](?:-?[a-z0-9])+$/;
/** Pattern of an extension point, a publisher and a service name. */
const NAME = /^[a-z][a-z0-9-]{1,31}$/;
const ROUTE_PREFIX = /^\/(?:[a-z0-9][a-z0-9._-]{0,63}\/){1,8}$/;
const NAME_PREFIX = /^arkvory_[a-z][a-z0-9_]{0,38}_$/;

type Fields = Readonly<Record<string, unknown>>;

function fields(input: unknown): Fields {
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    throw new ModuleManifestError('type', '');
  return Object.fromEntries(Object.entries(input));
}

function refuseUnknown(row: Fields) {
  const unknown = Object.keys(row).find((key) => !FIELDS.some((field) => field === key));
  if (unknown !== undefined) throw new ModuleManifestError('unknown_field', `/${unknown}`);
}

function present(row: Fields, key: (typeof FIELDS)[number]): unknown {
  const value = row[key];
  if (value === undefined) throw new ModuleManifestError('required', `/${key}`);
  return value;
}

function text(row: Fields, key: (typeof FIELDS)[number], valid: (value: string) => boolean) {
  const value = present(row, key);
  if (typeof value !== 'string') throw new ModuleManifestError('type', `/${key}`);
  if (!valid(value)) throw new ModuleManifestError('format', `/${key}`);
  return value;
}

function nullableText(row: Fields, key: 'metricPrefix' | 'tablePrefix') {
  return present(row, key) === null ? null : text(row, key, (value) => NAME_PREFIX.test(value));
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== 'string') throw new ModuleManifestError('type', path);
  const found = allowed.find((item) => item === value);
  if (found === undefined) throw new ModuleManifestError('format', path);
  return found;
}

function list<T>(
  row: Fields,
  key: (typeof FIELDS)[number],
  limits: { readonly min: number; readonly max: number },
  item: (value: unknown, path: string) => T,
): readonly T[] {
  const value = present(row, key);
  if (!Array.isArray(value)) throw new ModuleManifestError('type', `/${key}`);
  const items: unknown[] = value;
  if (items.length < limits.min || items.length > limits.max)
    throw new ModuleManifestError('format', `/${key}`);
  const result = items.map((entry, index) => item(entry, `/${key}/${String(index)}`));
  result.forEach((entry, index) => {
    if (result.indexOf(entry) !== index)
      throw new ModuleManifestError('duplicate', `/${key}/${String(index)}`);
  });
  return result;
}

function matching(pattern: RegExp) {
  return (value: unknown, path: string): string => {
    if (typeof value !== 'string') throw new ModuleManifestError('type', path);
    if (!pattern.test(value)) throw new ModuleManifestError('format', path);
    return value;
  };
}

/** A capability entry; two entries of one list, or of `requires` and `optional`, share no name. */
function capability(parse: typeof parseProvidedCapability) {
  return (value: unknown, path: string): string => {
    if (typeof value !== 'string') throw new ModuleManifestError('type', path);
    if (value.length > 128 || parse(value) === null) throw new ModuleManifestError('format', path);
    return value;
  };
}

function distinctNames(lists: readonly (readonly [string, readonly string[]])[]): void {
  const seen = new Set<string>();
  for (const [key, entries] of lists)
    entries.forEach((value, index) => {
      const name = (parseProvidedCapability(value) ?? parseRequiredCapability(value))?.name;
      if (name === undefined || seen.has(name))
        throw new ModuleManifestError('duplicate', `/${key}/${String(index)}`);
      seen.add(name);
    });
}

const MAX_DATA_MIB = 1024 * 1024;
const MAX_DATA_FILES = 10_000_000;

function count(value: unknown, path: string, max: number): number {
  if (typeof value !== 'number') throw new ModuleManifestError('type', path);
  if (!Number.isSafeInteger(value) || value < 0 || value > max)
    throw new ModuleManifestError('format', path);
  return value;
}

function resources(row: Fields): ModuleResources | null {
  const value = row['resources'];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value))
    throw new ModuleManifestError('type', '/resources');
  const fields = Object.fromEntries(Object.entries(value));
  const unknown = Object.keys(fields).find((key) => key !== 'dataMiB' && key !== 'dataFiles');
  if (unknown !== undefined)
    throw new ModuleManifestError('unknown_field', `/resources/${unknown}`);
  for (const key of ['dataMiB', 'dataFiles'])
    if (fields[key] === undefined) throw new ModuleManifestError('required', `/resources/${key}`);
  return {
    dataMiB: count(fields['dataMiB'], '/resources/dataMiB', MAX_DATA_MIB),
    dataFiles: count(fields['dataFiles'], '/resources/dataFiles', MAX_DATA_FILES),
  };
}

function format(row: Fields): typeof MODULE_MANIFEST_FORMAT {
  const value = present(row, 'format');
  if (typeof value !== 'number') throw new ModuleManifestError('type', '/format');
  if (value !== MODULE_MANIFEST_FORMAT)
    throw new ModuleManifestError('unsupported_format', '/format');
  return MODULE_MANIFEST_FORMAT;
}

/**
 * Reads a manifest from untrusted input. Unknown fields, wrong types, malformed names and
 * duplicate list entries are refused with a machine code and the field's JSON Pointer.
 */
export function parseModuleManifest(input: unknown): ModuleManifest {
  const row = fields(input);
  // The format decides which fields exist: a manifest of a later format is unsupported, not
  // malformed, whatever fields it has.
  const manifestFormat = format(row);
  refuseUnknown(row);
  const core = present(row, 'core');
  if (typeof core !== 'boolean') throw new ModuleManifestError('type', '/core');
  const limits = { min: 0, max: 32 };
  const requires = list(row, 'requires', limits, capability(parseRequiredCapability));
  const optional =
    row['optional'] === undefined
      ? []
      : list(row, 'optional', limits, capability(parseRequiredCapability));
  const provides = list(row, 'provides', limits, capability(parseProvidedCapability));
  distinctNames([
    ['requires', requires],
    ['optional', optional],
  ]);
  distinctNames([['provides', provides]]);
  return {
    format: manifestFormat,
    id: text(row, 'id', (value) => MODULE_ID_PATTERN.test(value)),
    version: text(row, 'version', (value) => parseSemanticVersion(value) !== null),
    extensionApi: text(row, 'extensionApi', (value) => parseCaretRange(value) !== null),
    kind: text(row, 'kind', (value) => NAME.test(value)),
    publisher: text(row, 'publisher', (value) => NAME.test(value)),
    core,
    roles: list(row, 'roles', { min: 1, max: MODULE_ROLES.length }, (value, path) =>
      oneOf(value, MODULE_ROLES, path),
    ),
    ...(row['compute'] === undefined ? {} : { compute: computeTasks(row['compute']) }),
    uses: row['uses'] === undefined ? [] : list(row, 'uses', { min: 0, max: 32 }, matching(NAME)),
    requires,
    optional,
    provides,
    exposeTo:
      row['exposeTo'] === undefined
        ? []
        : list(row, 'exposeTo', { min: 0, max: MODULE_SOURCES.length }, (value, path) =>
            oneOf(value, MODULE_SOURCES, path),
          ),
    resources: resources(row),
    routePrefixes: list(row, 'routePrefixes', { min: 0, max: 16 }, matching(ROUTE_PREFIX)),
    metricPrefix: nullableText(row, 'metricPrefix'),
    tablePrefix: nullableText(row, 'tablePrefix'),
  };
}

function computeTasks(value: unknown): readonly ComputeTask[] {
  if (!Array.isArray(value) || value.length > 16) throw new ModuleManifestError('type', '/compute');
  const names = new Set<string>();
  return value.map((task: unknown, index) => {
    const path = `/compute/${String(index)}`;
    if (typeof task !== 'object' || task === null) throw new ModuleManifestError('type', path);
    const name: unknown = Reflect.get(task, 'name');
    const entry: unknown = Reflect.get(task, 'entry');
    if (
      Object.keys(task).some((key) => key !== 'name' && key !== 'entry') ||
      typeof name !== 'string' ||
      !/^[a-z][a-z0-9-]{0,31}$/.test(name) ||
      names.has(name) ||
      typeof entry !== 'string' ||
      !/^files\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.mjs$/.test(entry)
    )
      throw new ModuleManifestError('format', path);
    names.add(name);
    return { name, entry };
  });
}
