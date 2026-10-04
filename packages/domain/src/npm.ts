import { ArkvoryError } from './errors.js';

/**
 * npm registry rules (ADR 0066) for Unity Package Manager scoped registries and npm clients,
 * free of HTTP and storage. A published version is immutable; dist-tags move between versions.
 * The manifest of record is `package.json` inside the tarball, so a mirror derives the same one.
 */
export const npmFeedActions = {
  version: 'npm.version',
  tag: 'npm.tag',
  tagDeleted: 'npm.tag.delete',
} as const;
export const MAX_NPM_NAME_LENGTH = 214;
export const MAX_NPM_MANIFEST_BYTES = 1024 * 1024;

const invalid = (message: string) => new ArkvoryError('invalid_input', message);
const namePattern = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
// SemVer 2.0.0 as published on semver.org.
const versionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
// A tag starts with a letter and is not `v1…`, `x` or `X`, so that no tag reads as a version.
const tagPattern = /^(?!v\d)(?![xX]$)[A-Za-z][A-Za-z0-9._-]{0,63}$/;

export const isNpmName = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= MAX_NPM_NAME_LENGTH && namePattern.test(value);
export const isNpmVersion = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 256 && versionPattern.test(value);
export const isNpmTag = (value: unknown): value is string =>
  typeof value === 'string' && tagPattern.test(value);

export function requireNpmName(value: unknown): string {
  if (!isNpmName(value)) throw invalid('Invalid package name');
  return value;
}
export function requireNpmVersion(value: unknown): string {
  if (!isNpmVersion(value)) throw invalid('Invalid package version');
  return value;
}
export function requireNpmTag(value: unknown): string {
  if (!isNpmTag(value)) throw invalid('Invalid dist-tag');
  return value;
}

/** `com.example.tools-1.2.0.tgz`, `tools-1.2.0.tgz` for `@scope/tools`. */
export const npmTarballFile = (name: string, version: string) =>
  `${name.slice(name.indexOf('/') + 1)}-${version}.tgz`;

function fields(value: unknown, what: string): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw invalid(`${what} must be a JSON object`);
  return Object.fromEntries(Object.entries(value));
}
function single(value: unknown, what: string): [string, unknown] {
  const entries = Object.entries(fields(value, what));
  const [first] = entries;
  if (entries.length !== 1 || !first) throw invalid(`${what} must hold exactly one entry`);
  return first;
}

export interface NpmManifest {
  readonly name: string;
  readonly version: string;
  readonly description: string | null;
  readonly keywords: readonly string[];
  /** The whole package.json; the registry serves it with its own name, version and dist. */
  readonly document: Readonly<Record<string, unknown>>;
}
export function parseNpmManifest(value: unknown): NpmManifest {
  const document = fields(value, 'package.json');
  const keywords = document['keywords'];
  const description = document['description'];
  return {
    name: requireNpmName(document['name']),
    version: requireNpmVersion(document['version']),
    description: typeof description === 'string' ? description.slice(0, 1024) : null,
    keywords: Array.isArray(keywords)
      ? keywords.filter((item): item is string => typeof item === 'string').slice(0, 64)
      : [],
    document,
  };
}

export interface NpmPublish {
  readonly version: string;
  readonly tags: readonly string[];
  /** What the client computed for its tarball; checked against the bytes received. */
  readonly declared: {
    readonly shasum: string | null;
    readonly integrity: string | null;
    readonly length: number | null;
  };
}
/**
 * The document of `npm publish`: one version and its one tarball, with the dist-tags pointing
 * at it. The tarball content is not part of it; its manifest must agree with this document.
 * Deprecation and unpublishing send whole packuments without attachments and are refused.
 */
export function parseNpmPublish(value: unknown, name: string): NpmPublish {
  const document = fields(value, 'The publish document');
  if (document['_attachments'] === undefined)
    throw invalid('Only publishing a new version is supported');
  if (document['name'] !== undefined && document['name'] !== name)
    throw invalid('The document names another package');
  const [version, entry] = single(document['versions'], 'versions');
  requireNpmVersion(version);
  const manifest = fields(entry, 'The version');
  if (manifest['name'] !== name || manifest['version'] !== version)
    throw invalid('The version names another package or version');
  const [, attachment] = single(document['_attachments'], '_attachments');
  const length = fields(attachment, 'The attachment')['length'];
  const dist = manifest['dist'] === undefined ? {} : fields(manifest['dist'], 'dist');
  const { shasum, integrity } = dist;
  const tags = Object.entries(fields(document['dist-tags'] ?? {}, 'dist-tags')).map(
    ([tag, target]) => {
      if (target !== version) throw invalid('A dist-tag of a publish must name its version');
      return requireNpmTag(tag);
    },
  );
  return {
    version,
    tags,
    declared: {
      shasum: typeof shasum === 'string' ? shasum.toLowerCase() : null,
      integrity: typeof integrity === 'string' && integrity.length <= 4096 ? integrity : null,
      length: typeof length === 'number' && Number.isSafeInteger(length) ? length : null,
    },
  };
}

/** Base64 digests of a tarball, as Subresource Integrity strings carry them. */
export interface NpmDigests {
  readonly sha1: string;
  readonly sha256: string;
  readonly sha512: string;
}
/**
 * Whether a declared SRI string names these bytes: every hash of an algorithm the registry
 * computes must match; others (sha384) cannot be checked and are ignored.
 */
export function npmIntegrityMatches(declared: string, digests: NpmDigests): boolean {
  for (const item of declared.trim().split(/\s+/)) {
    const [algorithm, rest] = item.split(/-(.*)/s, 2);
    const expected =
      algorithm === 'sha1' || algorithm === 'sha256' || algorithm === 'sha512'
        ? digests[algorithm]
        : null;
    if (expected !== null && rest?.split('?')[0] !== expected) return false;
  }
  return true;
}

export interface NpmVersionRecord {
  readonly version: string;
  readonly manifest: Readonly<Record<string, unknown>>;
  readonly file: string;
  /** Hex SHA-1, as `dist.shasum`. */
  readonly shasum: string;
  /** `sha512-…`, as `dist.integrity`. */
  readonly integrity: string;
  readonly publishedAt: string;
}
/** The packument clients read: each version is its package.json with the registry's dist. */
export function npmPackument(
  name: string,
  versions: readonly NpmVersionRecord[],
  tags: Readonly<Record<string, string>>,
  tarballBase: string,
) {
  const times = versions.map((item) => item.publishedAt).sort();
  return {
    _id: name,
    name,
    'dist-tags': tags,
    versions: Object.fromEntries(
      versions.map((item) => [
        item.version,
        {
          ...item.manifest,
          name,
          version: item.version,
          _id: `${name}@${item.version}`,
          dist: {
            tarball: tarballBase + item.file,
            shasum: item.shasum,
            integrity: item.integrity,
          },
        },
      ]),
    ),
    time: {
      created: times[0],
      modified: times.at(-1),
      ...Object.fromEntries(versions.map((item) => [item.version, item.publishedAt])),
    },
  };
}

export interface NpmFeedDetail {
  readonly name: string;
  readonly version: string | null;
  readonly tag: string | null;
}
/** The detail of an `npm.*` feed entry (JSON); null when malformed. */
export function parseNpmDetail(detail: string | null): NpmFeedDetail | null {
  if (detail === null || detail.length > 4096) return null;
  let value: unknown;
  try {
    value = JSON.parse(detail);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const fields: Readonly<Record<string, unknown>> = Object.fromEntries(Object.entries(value));
  const { name, version, tag } = fields;
  if (!isNpmName(name)) return null;
  if (version !== undefined && !isNpmVersion(version)) return null;
  if (tag !== undefined && !isNpmTag(tag)) return null;
  return { name, version: version ?? null, tag: tag ?? null };
}
