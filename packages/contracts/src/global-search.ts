import { artifactSearchItemSchema, readArtifactSearchItem } from './artifact-search.js';
import type { ArtifactSearchItemResponse } from './artifact-search.js';
import { record, text, items } from './wire-values.js';

/** One result of the installation-wide search (ADR 0081, A1): a repository search item. */
export interface GlobalSearchItemResponse extends ArtifactSearchItemResponse {
  repository: string;
}
export interface GlobalSearchPageResponse {
  items: GlobalSearchItemResponse[];
  /** Opaque cursor of the last item when more may follow; pass it back as `after`. */
  next: string | null;
}
/** Filters of `GET /api/v1/search`; every given filter must match. */
export interface GlobalSearchQuery {
  /** Case-insensitive substring of the name or of a current metadata value. */
  q?: string;
  /** Only these repositories (at most 100); unreadable ones are skipped silently. */
  repositories?: readonly string[];
  /** Every one of these current labels (at most 8). */
  labels?: readonly string[];
  stage?: string;
  after?: string;
  /** 1–100, 50 by default. */
  limit?: number;
}

export const globalSearchLimits = {
  /** Repositories one search reads at most: the first by name, as fleet reads (ADR 0077). */
  repositories: 1000,
  repositoryFilter: 100,
  labels: 8,
  query: 240,
  cursor: 160,
  pageSize: 100,
  defaultPageSize: 50,
} as const;

const repositoryPattern = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function readGlobalSearchPage(value: unknown): GlobalSearchPageResponse {
  const r = record(value);
  const list = items(r['items']);
  if (list.length > globalSearchLimits.pageSize) throw new Error('Invalid search page');
  const next = r['next'] === null ? null : text(r['next']);
  if (next !== null && (next.length === 0 || next.length > globalSearchLimits.cursor))
    throw new Error('Invalid search cursor');
  return {
    items: list.map((entry) => {
      const repository = text(record(entry)['repository']);
      if (!repositoryPattern.test(repository)) throw new Error('Invalid search repository');
      return { ...readArtifactSearchItem(entry), repository };
    }),
    next,
  };
}

const list = (name: string, maxItems: number, description: string) => ({
  name,
  in: 'query',
  description,
  schema: { type: 'string', maxLength: maxItems * 65 },
});
export const globalSearchPaths = {
  '/api/v1/search': {
    get: {
      summary:
        'Search artifacts in every repository the caller may list (at most 1000 by name); newest publication first, pages of up to 100 with an opaque cursor',
      parameters: [
        {
          name: 'q',
          in: 'query',
          description: 'Case-insensitive substring of the name or of a current metadata value.',
          schema: { type: 'string', maxLength: globalSearchLimits.query },
        },
        list(
          'repositories',
          globalSearchLimits.repositoryFilter,
          'Comma-separated repositories, at most 100. Repositories the caller cannot list are skipped as if absent.',
        ),
        list(
          'labels',
          globalSearchLimits.labels,
          'Comma-separated current labels, at most 8; all must be present.',
        ),
        {
          name: 'stage',
          in: 'query',
          description: 'Current promotion stage.',
          schema: { type: 'string', pattern: '^[a-z0-9][a-z0-9_.-]{0,31}$' },
        },
        {
          name: 'after',
          in: 'query',
          description: 'Opaque cursor: `next` of the previous page with the same filters.',
          schema: { type: 'string', maxLength: globalSearchLimits.cursor },
        },
        {
          name: 'limit',
          in: 'query',
          schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
        },
      ],
      responses: {
        '200': {
          description: 'Success',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['items', 'next'],
                properties: {
                  items: {
                    type: 'array',
                    maxItems: globalSearchLimits.pageSize,
                    items: {
                      ...artifactSearchItemSchema,
                      required: [...artifactSearchItemSchema.required, 'repository'],
                      properties: {
                        ...artifactSearchItemSchema.properties,
                        repository: { type: 'string', pattern: repositoryPattern.source },
                      },
                    },
                  },
                  next: { type: 'string', nullable: true, maxLength: globalSearchLimits.cursor },
                },
              },
            },
          },
        },
        default: {
          description:
            'Native error object: code, message, requestId. 400 invalid filter or cursor; 503 Retry-After.',
        },
      },
    },
  },
};
