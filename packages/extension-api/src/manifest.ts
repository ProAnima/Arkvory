import { parseCaretRange, parseSemanticVersion } from './version.js';

/** The only manifest format this version reads. */
export const MODULE_MANIFEST_FORMAT = 1;

/** Extension points a module may implement (ADR 0079, section 5). */
export const MODULE_KINDS = [
  'protocol',
  'storage-backend',
  'backup-vault',
  'identity-provider',
  'event-sink',
  'transfer',
] as const;
export type ModuleKind = (typeof MODULE_KINDS)[number];

/** Processes a module runs in: the writer, read gateways, the worker and the backup agent. */
export const MODULE_ROLES = ['api', 'reader', 'worker', 'backup'] as const;
export type ModuleRole = (typeof MODULE_ROLES)[number];

/** What the core reads about a module before creating it; no code and no configuration. */
export interface ModuleManifest {
  readonly format: typeof MODULE_MANIFEST_FORMAT;
  /** `[a-z][a-z0-9-]{1,31}`; unique within an installation. */
  readonly id: string;
  /** Semver version of the module. */
  readonly version: string;
  /** Caret range of extension API versions the module works with, such as `^0.1.0`. */
  readonly extensionApi: string;
  readonly kind: ModuleKind;
  /** A core module is part of the free core and is never disabled. */
  readonly core: boolean;
  readonly roles: readonly ModuleRole[];
  /** Capabilities the module needs from other enabled modules. */
  readonly requires: readonly string[];
  /** Capabilities the module gives other modules; one provider per capability. */
  readonly provides: readonly string[];
  /** Path prefixes of the routes the module serves, each starting and ending with `/`. */
  readonly routePrefixes: readonly string[];
  /** Prefix of every metric the module publishes, or null for none. */
  readonly metricPrefix: string | null;
  /** Prefix of every table the module owns, or null for none. */
  readonly tablePrefix: string | null;
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
  'core',
  'roles',
  'requires',
  'provides',
  'routePrefixes',
  'metricPrefix',
  'tablePrefix',
] as const;
export const MODULE_ID_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;
const CAPABILITY = /^[a-z][a-z0-9-]{0,63}$/;
const ROUTE_PREFIX = /^\/(?:[a-z0-9][a-z0-9._-]{0,63}\/){1,8}$/;
const NAME_PREFIX = /^arkvory_[a-z][a-z0-9_]{0,38}_$/;

type Fields = Readonly<Record<string, unknown>>;

function fields(input: unknown): Fields {
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    throw new ModuleManifestError('type', '');
  const entries = Object.fromEntries(Object.entries(input));
  const unknown = Object.keys(entries).find((key) => !FIELDS.some((field) => field === key));
  if (unknown !== undefined) throw new ModuleManifestError('unknown_field', `/${unknown}`);
  return entries;
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
  const core = present(row, 'core');
  if (typeof core !== 'boolean') throw new ModuleManifestError('type', '/core');
  return {
    format: format(row),
    id: text(row, 'id', (value) => MODULE_ID_PATTERN.test(value)),
    version: text(row, 'version', (value) => parseSemanticVersion(value) !== null),
    extensionApi: text(row, 'extensionApi', (value) => parseCaretRange(value) !== null),
    kind: oneOf(present(row, 'kind'), MODULE_KINDS, '/kind'),
    core,
    roles: list(row, 'roles', { min: 1, max: MODULE_ROLES.length }, (value, path) =>
      oneOf(value, MODULE_ROLES, path),
    ),
    requires: list(row, 'requires', { min: 0, max: 32 }, matching(CAPABILITY)),
    provides: list(row, 'provides', { min: 0, max: 32 }, matching(CAPABILITY)),
    routePrefixes: list(row, 'routePrefixes', { min: 0, max: 16 }, matching(ROUTE_PREFIX)),
    metricPrefix: nullableText(row, 'metricPrefix'),
    tablePrefix: nullableText(row, 'tablePrefix'),
  };
}
