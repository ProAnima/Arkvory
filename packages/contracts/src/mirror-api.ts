import { integer, items, record, text } from './wire-values.js';

/*
 * Repository change feed that mirrors follow (ADR 0058). Sequences are decimal strings of a
 * per-repository order; an action is a plain string so a newer server may add actions, and a
 * mirror treats an unknown action as "re-read this artifact".
 */
export interface CatalogChangeResponse {
  readonly sequence: string;
  readonly action: string;
  readonly artifactId: string;
  /** Asset path or stage the change concerns; null for artifact-level changes. */
  readonly detail: string | null;
}
export interface CatalogChangePageResponse {
  readonly items: readonly CatalogChangeResponse[];
  /** Newest committed sequence of the repository when the page was read. */
  readonly head: string;
  /** Cursor of the next page; null when this page reached the head. */
  readonly next: string | null;
}

/** Repository-relative operations, registered like the promotion operations. */
export const mirrorOperations = [
  // List access and no actors: a read-only key of a mirror follows the feed.
  ['/changes', 'get', 'listCatalogChanges', ['artifact.list'], ['read'], 'read'],
  // Status of a mirrored repository of this installation; 404 for an ordinary repository.
  ['/mirror', 'get', 'getRepositoryMirror', ['repository.read'], ['read'], 'read'],
] as const;

export const mirrorPhases = ['pending', 'seeding', 'following'] as const;
export type MirrorPhaseName = (typeof mirrorPhases)[number];
export const mirrorSeedSteps = ['artifacts', 'packages', 'assets'] as const;
/**
 * Synchronization of a mirrored repository (ADR 0058). `pending`: the worker has not started
 * it yet. `caughtUp`: the applied cursor equals the last source head seen; null while seeding.
 * Sequences are global journal numbers, so their difference is not a count of changes.
 * Times are ISO 8601 UTC; byte counts are decimal strings.
 */
export interface RepositoryMirrorResponse {
  readonly repository: string;
  readonly upstream: string;
  readonly sourceRepository: string;
  readonly phase: MirrorPhaseName;
  readonly seedStep: (typeof mirrorSeedSteps)[number] | null;
  readonly cursor: string;
  readonly head: string | null;
  readonly caughtUp: boolean | null;
  readonly checkedAt: string | null;
  readonly syncedAt: string | null;
  readonly errorCode: string | null;
  readonly errorAt: string | null;
  readonly copiedArtifacts: number;
  readonly copiedBytes: string;
}

const sequence = (value: unknown): string => {
  const parsed = text(value);
  if (!/^[0-9]{1,18}$/.test(parsed)) throw new Error('Invalid server sequence');
  return parsed;
};

const optional = <T>(value: unknown, read: (value: unknown) => T): T | null =>
  value === null ? null : read(value);
function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  const found = allowed.find((item) => item === value);
  if (found === undefined) throw new Error('Invalid server enumeration');
  return found;
}

export function readRepositoryMirror(value: unknown): RepositoryMirrorResponse {
  const row = record(value);
  return {
    repository: text(row['repository']),
    upstream: text(row['upstream']),
    sourceRepository: text(row['sourceRepository']),
    phase: oneOf(row['phase'], mirrorPhases),
    seedStep: optional(row['seedStep'], (step) => oneOf(step, mirrorSeedSteps)),
    cursor: sequence(row['cursor']),
    head: optional(row['head'], sequence),
    caughtUp: optional(row['caughtUp'], (value) => {
      if (typeof value !== 'boolean') throw new Error('Invalid server boolean');
      return value;
    }),
    checkedAt: optional(row['checkedAt'], text),
    syncedAt: optional(row['syncedAt'], text),
    errorCode: optional(row['errorCode'], text),
    errorAt: optional(row['errorAt'], text),
    copiedArtifacts: integer(row['copiedArtifacts']),
    copiedBytes: sequence(row['copiedBytes']),
  };
}

export function readCatalogChangePage(value: unknown): CatalogChangePageResponse {
  const page = record(value);
  return {
    items: items(page['items']).map((entry) => {
      const change = record(entry);
      const detail = change['detail'];
      return {
        sequence: sequence(change['sequence']),
        action: text(change['action']),
        artifactId: text(change['artifactId']),
        detail: detail === null ? null : text(detail),
      };
    }),
    head: sequence(page['head']),
    next: page['next'] === null ? null : sequence(page['next']),
  };
}

const str = { type: 'string' } as const;
const decimal = { type: 'string', pattern: '^[0-9]{1,18}$' } as const;
const repository = {
  name: 'repository',
  in: 'path',
  required: true,
  schema: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' },
};
const nullableText = { type: 'string', nullable: true } as const;
const nullableDecimal = { ...decimal, nullable: true } as const;
const nullableTime = { type: 'string', format: 'date-time', nullable: true } as const;
const mirrorSchema = {
  type: 'object',
  required: [
    'repository',
    'upstream',
    'sourceRepository',
    'phase',
    'seedStep',
    'cursor',
    'head',
    'caughtUp',
    'checkedAt',
    'syncedAt',
    'errorCode',
    'errorAt',
    'copiedArtifacts',
    'copiedBytes',
  ],
  properties: {
    repository: str,
    upstream: { type: 'string', format: 'uri' },
    sourceRepository: str,
    phase: { type: 'string', enum: mirrorPhases },
    seedStep: { type: 'string', enum: mirrorSeedSteps, nullable: true },
    cursor: decimal,
    head: nullableDecimal,
    caughtUp: { type: 'boolean', nullable: true },
    checkedAt: nullableTime,
    syncedAt: nullableTime,
    errorCode: nullableText,
    errorAt: nullableTime,
    copiedArtifacts: { type: 'integer', minimum: 0 },
    copiedBytes: decimal,
  },
};
export const mirrorPaths: Record<string, Record<string, unknown>> = {
  '/api/v1/repositories/{repository}/mirror': {
    parameters: [repository],
    get: {
      summary: 'Synchronization of a mirrored repository of this installation (ADR 0058)',
      responses: {
        200: { description: 'Success', content: { 'application/json': { schema: mirrorSchema } } },
        default: {
          description: 'Native error object; 404 when the repository is not a mirror',
        },
      },
    },
  },
  '/api/v1/repositories/{repository}/changes': {
    parameters: [repository],
    get: {
      summary:
        'Ordered change feed of the repository for mirrors: list access, no actors, up to 100 per page',
      parameters: [
        { name: 'after', in: 'query', schema: decimal, description: 'Sequence cursor, default 0' },
        { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
      ],
      responses: {
        200: {
          description: 'Success',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['items', 'head', 'next'],
                properties: {
                  items: {
                    type: 'array',
                    items: {
                      type: 'object',
                      required: ['sequence', 'action', 'artifactId', 'detail'],
                      properties: {
                        sequence: decimal,
                        action: str,
                        artifactId: { type: 'string', format: 'uuid' },
                        detail: { type: 'string', nullable: true },
                      },
                    },
                  },
                  head: decimal,
                  next: { ...decimal, nullable: true },
                },
              },
            },
          },
        },
        default: { description: 'Native error object: code, reason, message, requestId' },
      },
    },
  },
};
