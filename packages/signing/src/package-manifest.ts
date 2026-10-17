import {
  ModuleManifestError,
  parseCaretRange,
  parseModuleManifest,
  parseSemanticVersion,
  satisfiesCaret,
} from '@proanima/arkvory-extension-api';
import type { ModuleManifest, ModuleRole } from '@proanima/arkvory-extension-api';
import { SigningError } from './errors.js';
import { EntryNames, FILES_DIRECTORY, refuseNativeAddon, safePath } from './package-paths.js';

/** What a module may store (ADR 0078, I1). */
export const DATA_CLASSES = ['none', 'auxiliary', 'layout'] as const;
export type DataClass = (typeof DATA_CLASSES)[number];

/** One file of a package with its exact length and digest. */
export interface PackageFile {
  /** Starts with `files/`. */
  readonly path: string;
  readonly size: number;
  /** Lowercase hex SHA-256. */
  readonly sha256: string;
}

/** The fields of `module.json` that describe the package rather than the module (ADR 0078, 3.1). */
export interface PackageFields {
  /** Server packages only in format 1 of this core; client packages come with arkvoryctl (X5). */
  readonly side: 'server';
  /** The ES module each role imports, a path of `files`. */
  readonly entry: Readonly<Partial<Record<ModuleRole, string>>>;
  readonly dataClass: DataClass;
  /** The license feature the module itself checks, or null. */
  readonly licenseFeature: string | null;
  /** Caret range of core releases, or null for any release the extension API admits. */
  readonly coreRelease: string | null;
  readonly files: readonly PackageFile[];
}

export interface PackageManifest {
  readonly module: ModuleManifest;
  readonly package: PackageFields;
}

/** Limits a package is read with; checked before any byte of an entry is read. */
export const PACKAGE_LIMITS = {
  /** The compressed archive. */
  archiveBytes: 1024 ** 3,
  /** The uncompressed archive, tar headers included. */
  totalBytes: 1024 ** 3,
  fileBytes: 256 * 1024 ** 2,
  files: 4096,
  /** Tar entries, directories included. */
  entries: 8192,
  manifestBytes: 1024 * 1024,
  signatureBytes: 4096,
  revocationsBytes: 1024 * 1024,
} as const;

const PACKAGE_FIELDS = ['side', 'entry', 'dataClass', 'licenseFeature', 'coreRelease', 'files'];
const FEATURE = /^[a-z][a-z0-9-]{1,63}$/;
const DIGEST = /^[0-9a-f]{64}$/;

type Row = Readonly<Record<string, unknown>>;

function invalid(path: string): SigningError {
  return new SigningError('manifest_invalid', path);
}

function packageFile(value: unknown, index: number, names: EntryNames): PackageFile {
  const at = `/files/${String(index)}`;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw invalid(at);
  const row: Row = Object.fromEntries(Object.entries(value));
  if (Object.keys(row).some((key) => !['path', 'size', 'sha256'].includes(key))) throw invalid(at);
  const { path, size, sha256 } = row;
  if (typeof path !== 'string' || !path.startsWith(`${FILES_DIRECTORY}/`))
    throw invalid(`${at}/path`);
  if (safePath(path) !== path) throw invalid(`${at}/path`);
  refuseNativeAddon(path);
  names.add(path, 'file');
  if (
    typeof size !== 'number' ||
    !Number.isSafeInteger(size) ||
    size < 0 ||
    size > PACKAGE_LIMITS.fileBytes
  )
    throw invalid(`${at}/size`);
  if (typeof sha256 !== 'string' || !DIGEST.test(sha256)) throw invalid(`${at}/sha256`);
  return { path, size, sha256 };
}

function files(value: unknown): readonly PackageFile[] {
  if (!Array.isArray(value) || value.length > PACKAGE_LIMITS.files) throw invalid('/files');
  const names = new EntryNames();
  const list = value.map((item: unknown, index) => packageFile(item, index, names));
  const total = list.reduce((sum, file) => sum + file.size, 0);
  if (total > PACKAGE_LIMITS.totalBytes) throw invalid('/files');
  return list;
}

function entry(value: unknown, manifest: ModuleManifest, listed: readonly PackageFile[]) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw invalid('/entry');
  const row: Row = Object.fromEntries(Object.entries(value));
  const result: Partial<Record<ModuleRole, string>> = {};
  for (const [role, path] of Object.entries(row)) {
    const known = manifest.roles.find((candidate) => candidate === role);
    if (known === undefined) throw invalid(`/entry/${role}`);
    if (typeof path !== 'string' || !path.endsWith('.mjs') || !listed.some((f) => f.path === path))
      throw invalid(`/entry/${role}`);
    result[known] = path;
  }
  const missing = manifest.roles.find((role) => result[role] === undefined);
  if (missing !== undefined) throw invalid(`/entry/${missing}`);
  return result;
}

function nullable(row: Row, key: string, valid: (text: string) => boolean): string | null {
  const value = row[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !valid(value)) throw invalid(`/${key}`);
  return value;
}

function moduleManifest(rest: Row): ModuleManifest {
  try {
    return parseModuleManifest(rest);
  } catch (error) {
    if (error instanceof ModuleManifestError)
      throw new SigningError(
        'manifest_invalid',
        `${error.code} ${error.path === '' ? '/' : error.path}`,
        {
          cause: error,
        },
      );
    throw error;
  }
}

/**
 * Reads `module.json` as untrusted input: the package fields here, every other field with
 * `parseModuleManifest` of extension-api, so a package and a built-in module are read by the
 * same rules. `licenseFeature` and `coreRelease` may be absent (null); the rest is required.
 */
export function parsePackageManifest(input: unknown): PackageManifest {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw invalid('');
  const row: Row = Object.fromEntries(Object.entries(input));
  const rest = Object.fromEntries(
    Object.entries(row).filter(([key]) => !PACKAGE_FIELDS.includes(key)),
  );
  const module = moduleManifest(rest);
  // `modules/<id>/<version>/` is a directory name: on a case-folding file system (Windows,
  // macOS) `1.0.0-Beta` and `1.0.0-beta` would be one package, and replacing one would delete
  // the other. Module ids are lower case already.
  if (/[A-Z]/.test(module.version)) throw invalid('/version');
  if (row['side'] !== 'server') throw invalid('/side');
  const dataClass = DATA_CLASSES.find((value) => value === row['dataClass']);
  if (dataClass === undefined) throw invalid('/dataClass');
  const listed = files(row['files']);
  return {
    module,
    package: {
      side: 'server',
      entry: entry(row['entry'], module, listed),
      dataClass,
      licenseFeature: nullable(row, 'licenseFeature', (text) => FEATURE.test(text)),
      coreRelease: nullable(row, 'coreRelease', (text) => parseCaretRange(text) !== null),
      files: listed,
    },
  };
}

/** What the installing or loading core is; compatibility is checked against it. */
export interface CompatibilityHost {
  /** The extension API version the core implements (`EXTENSION_API_VERSION`). */
  readonly extensionApi: string;
  /** Release version of the core. */
  readonly coreVersion: string;
}

/**
 * Refuses a module whose extension API range or core release range the host does not satisfy
 * (`module_incompatible` with the module id). A host without a release version (a development
 * build) skips only the release range.
 */
export function checkCompatibility(manifest: PackageManifest, host: CompatibilityHost): void {
  const range = parseCaretRange(manifest.module.extensionApi);
  const api = parseSemanticVersion(host.extensionApi);
  if (!range || !api || !satisfiesCaret(range, api))
    throw new SigningError('module_incompatible', manifest.module.id);
  const release = manifest.package.coreRelease;
  const core = parseSemanticVersion(host.coreVersion);
  const releaseRange = release === null ? null : parseCaretRange(release);
  if (releaseRange && core && core.prerelease === null && !satisfiesCaret(releaseRange, core))
    throw new SigningError('module_incompatible', manifest.module.id);
}
