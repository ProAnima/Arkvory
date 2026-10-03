import { record, text } from './wire-values.js';

/*
 * Download links (ADR 0062): a holder of content.read asks for a link to one artifact; anyone
 * holding the link reads that artifact's content until it expires (an hour by default, a day at
 * most). The link is a query parameter so that curl, wget, browsers and deploy agents need no
 * header; it works on GET/HEAD of that artifact's content and nowhere else.
 */
export const downloadLinkLimits = { minSeconds: 60, defaultSeconds: 3600, maxSeconds: 86400 };
/** Repository-relative operations, registered like the mirror operations. */
export const downloadLinkOperationPolicies = [
  // A new link per call; a retried request only leaves an extra short-lived link.
  [
    '/artifacts/{id}/links',
    'post',
    'createDownloadLink',
    ['content.read'],
    ['read'],
    'never-automatic',
  ],
] as const;
/** Operations that accept a link instead of an Authorization header. */
export const downloadLinkOperations: readonly string[] = [
  'downloadArtifact',
  'headArtifactContent',
];

export interface DownloadLinkRequest {
  /** Lifetime; the server's default (an hour) when omitted. */
  readonly ttlSeconds?: number;
}
export interface DownloadLinkResponse {
  /** The secret, returned once; it never appears in logs or in later responses. */
  readonly token: string;
  /** Path of the content with the link, relative to the API origin. */
  readonly url: string;
  readonly expiresAt: string;
}

export function readDownloadLink(value: unknown): DownloadLinkResponse {
  const r = record(value);
  const token = text(r['token']);
  const url = text(r['url']);
  const expiresAt = text(r['expiresAt']);
  if (!/^dtl_[A-Za-z0-9_-]{43}$/.test(token) || !url.startsWith('/api/v1/repositories/'))
    throw new Error('Invalid download link');
  if (!Number.isFinite(Date.parse(expiresAt))) throw new Error('Invalid link expiry');
  return { token, url, expiresAt };
}

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
/** The link on the content route: GET and HEAD of that artifact only. */
export const downloadLinkParameter = {
  name: 'token',
  in: 'query',
  required: false,
  description: 'Download link from POST …/artifacts/{id}/links, instead of an Authorization header',
  schema: { type: 'string', pattern: '^dtl_[A-Za-z0-9_-]{43}$' },
};
export const downloadLinkPaths = {
  '/api/v1/repositories/{repository}/artifacts/{id}/links': {
    parameters: [repositoryParameter, idParameter],
    post: {
      summary:
        'Create a short-lived link to download this artifact; whoever holds it reads only this content until it expires',
      requestBody: {
        required: false,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                ttlSeconds: {
                  type: 'integer',
                  minimum: downloadLinkLimits.minSeconds,
                  maximum: downloadLinkLimits.maxSeconds,
                  default: downloadLinkLimits.defaultSeconds,
                },
              },
            },
          },
        },
      },
      responses: {
        '201': {
          description: 'The link; the token is shown only in this response.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                additionalProperties: false,
                required: ['token', 'url', 'expiresAt'],
                properties: {
                  token: { type: 'string', pattern: '^dtl_[A-Za-z0-9_-]{43}$' },
                  url: { type: 'string' },
                  expiresAt: { type: 'string', format: 'date-time' },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;
