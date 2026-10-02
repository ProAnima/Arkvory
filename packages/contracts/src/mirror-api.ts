import { items, record, text } from './wire-values.js';

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
] as const;

const sequence = (value: unknown): string => {
  const parsed = text(value);
  if (!/^[0-9]{1,18}$/.test(parsed)) throw new Error('Invalid server sequence');
  return parsed;
};

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
export const mirrorPaths: Record<string, Record<string, unknown>> = {
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
