import { integer, items, record, text } from './wire-values.js';

/**
 * Whether the table of contents of an archive artifact can be read (ADR 0083, N8, stage T2):
 * `ready` — `items` lists its file entries; `pending` — the worker has not built it yet;
 * `unavailable` — it never will be, `reason` says why (not an archive, an entry outside the
 * limits, an unsupported method). Later versions may add states; a client treats every unknown
 * one as `unavailable` and falls back to the whole archive (T1).
 */
export type ArtifactTreeStatus = 'ready' | 'pending' | 'unavailable';

/** One file entry of an archive, in archive order. */
export interface ArtifactTreeEntry {
  /** 0-based position among the file entries of the archive. */
  readonly ordinal: number;
  /** The entry's path inside the archive, `/`-separated, without a leading or trailing `/`. */
  readonly path: string;
  /** Decimal bytes of the file content. */
  readonly size: string;
  /** Lowercase hex SHA-256 of the file content, computed by the server from the archive. */
  readonly sha256: string;
  /** `stored` (the data range is the file itself) or `deflate`; later versions may add methods. */
  readonly method: string;
  /** Decimal byte offset of the entry's data in the archive, after its local header. */
  readonly dataOffset: string;
  /** Decimal bytes of the entry's data in the archive (compressed size). */
  readonly dataLength: string;
}

/** One page of the table of contents of an archive artifact. */
export interface ArtifactTree {
  readonly status: string;
  /** Why the table is `unavailable`, a machine code; null otherwise. */
  readonly reason: string | null;
  /** The SHA-256 of the archive the table describes: the artifact's own descriptor SHA-256. */
  readonly archiveSha256: string;
  /** Number of file entries when `ready`, otherwise null. */
  readonly entries: number | null;
  readonly items: readonly ArtifactTreeEntry[];
  /** Opaque cursor of the next page (`after`), or null after the last one. */
  readonly next: string | null;
}

/** The largest page of the table; the default page is the same. */
export const ARTIFACT_TREE_PAGE = 1000;

const decimal = { type: 'string', pattern: '^(0|[1-9][0-9]{0,15})$' };
const object = (properties: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});

export const artifactTreeEntrySchema = object({
  ordinal: { type: 'integer', minimum: 0, maximum: 99999 },
  path: { type: 'string', minLength: 1, maxLength: 1024 },
  size: decimal,
  sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  method: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,31}$' },
  dataOffset: decimal,
  dataLength: decimal,
});

export const artifactTreeSchema = object({
  status: { type: 'string', pattern: '^[a-z][a-z_]{0,31}$' },
  reason: { type: 'string', pattern: '^[a-z][a-z0-9_]{0,63}$', nullable: true },
  archiveSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  entries: { type: 'integer', minimum: 0, maximum: 100000, nullable: true },
  items: { type: 'array', maxItems: ARTIFACT_TREE_PAGE, items: artifactTreeEntrySchema },
  next: { type: 'string', pattern: '^(0|[1-9][0-9]{0,8})$', nullable: true },
});

/**
 * One capability of directory trees the server offers (ADR 0083, N8): the free core offers
 * `zip-tree` version `1.0.0` — the archive table of contents route — with `module: "core"` and
 * `prefix: "/api/v1/"`; a client module may offer another way under its module prefix.
 */
export interface TreeCapability {
  readonly name: string;
  /** Semver versions of the protocol, such as `1.0.0`. */
  readonly versions: readonly string[];
  readonly module: string;
  readonly prefix: string;
}

export const treeCapabilitySchema = object({
  name: { type: 'string', pattern: '^[a-z][a-z0-9-]{1,31}$' },
  versions: {
    type: 'array',
    minItems: 1,
    maxItems: 32,
    items: { type: 'string', maxLength: 64 },
  },
  module: { type: 'string', pattern: '^[a-z][a-z0-9-]{1,31}$' },
  prefix: { type: 'string', pattern: '^/api/(v1|ext/[a-z][a-z0-9-]{1,31}/v[1-9][0-9]{0,3})/$' },
});

const repositoryParameter = {
  name: 'repository',
  in: 'path',
  required: true,
  schema: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' },
};
const idParameter = {
  name: 'id',
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
};

export const artifactTreePaths = {
  '/api/v1/repositories/{repository}/artifacts/{id}/tree': {
    parameters: [repositoryParameter, idParameter],
    get: {
      summary: 'Read the table of contents of an archive artifact',
      parameters: [
        {
          name: 'after',
          in: 'query',
          schema: { type: 'string', pattern: '^(0|[1-9][0-9]{0,8})$' },
        },
        {
          name: 'limit',
          in: 'query',
          schema: { type: 'integer', minimum: 1, maximum: ARTIFACT_TREE_PAGE },
        },
      ],
      responses: {
        200: {
          description:
            'The file entries of the archive with their size, SHA-256 and data range, or why there are none yet',
          content: { 'application/json': { schema: artifactTreeSchema } },
        },
      },
    },
  },
};

const DIGEST = /^[a-f0-9]{64}$/;
/** A semver 2.0.0 version without build metadata, as extension API versions are written. */
const SEMVER =
  /^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const DECIMAL = /^(0|[1-9][0-9]{0,15})$/;

function digest(value: unknown): string {
  const result = text(value);
  if (!DIGEST.test(result)) throw new Error('Invalid server digest');
  return result;
}

function decimalText(value: unknown): string {
  const result = text(value);
  if (!DECIMAL.test(result) || !Number.isSafeInteger(Number(result)))
    throw new Error('Invalid server decimal');
  return result;
}

const nullable = <T>(value: unknown, read: (value: unknown) => T): T | null =>
  value === null || value === undefined ? null : read(value);

/** Validates one page of a table of contents; fields a newer server adds are left out. */
export function readArtifactTree(value: unknown): ArtifactTree {
  const row = record(value);
  const next = nullable(row['next'], text);
  if (next !== null && !/^(0|[1-9][0-9]{0,8})$/.test(next)) throw new Error('Invalid cursor');
  return {
    status: text(row['status']),
    reason: nullable(row['reason'], text),
    archiveSha256: digest(row['archiveSha256']),
    entries: nullable(row['entries'], integer),
    items: items(row['items']).map((entry) => {
      const item = record(entry);
      return {
        ordinal: integer(item['ordinal']),
        path: text(item['path']),
        size: decimalText(item['size']),
        sha256: digest(item['sha256']),
        method: text(item['method']),
        dataOffset: decimalText(item['dataOffset']),
        dataLength: decimalText(item['dataLength']),
      };
    }),
    next,
  };
}

/** Validates `capabilities.tree` or `capabilities.transfer` entries; malformed ones are dropped. */
export function readCapabilityOffers(value: unknown): readonly TreeCapability[] | undefined {
  if (value === undefined) return undefined;
  return items(value).flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return [];
    const row = record(entry);
    const { name, versions, module, prefix } = row;
    if (
      typeof name !== 'string' ||
      !/^[a-z][a-z0-9-]{1,31}$/.test(name) ||
      typeof module !== 'string' ||
      typeof prefix !== 'string' ||
      !Array.isArray(versions)
    )
      return [];
    const known = versions.filter(
      (version): version is string => typeof version === 'string' && SEMVER.test(version),
    );
    return known.length === 0 ? [] : [{ name, versions: known, module, prefix }];
  });
}
