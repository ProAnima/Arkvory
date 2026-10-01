import { nativeErrorResponse, requestIdHeader } from './errors.js';
export { nativeErrorSchema, nativeErrorResponse, requestIdHeader } from './errors.js';
const header = (description: string) => ({ description, schema: { type: 'string' } });
const contentHeaders = {
  'X-Request-Id': requestIdHeader,
  ETag: header('Strong validator: quoted sha256:<lowercase hex>.'),
  'Accept-Ranges': header('bytes'),
  'Content-Length': header('Decimal byte count; HEAD reports the full representation length.'),
  'Content-Disposition': header('attachment with UTF-8 filename*.'),
};
const bytes = { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } };
export const contentResponses = {
  '200': { description: 'Original immutable bytes.', headers: contentHeaders, content: bytes },
  '206': {
    description: 'One byte range.',
    headers: { ...contentHeaders, 'Content-Range': header('bytes start-end/size') },
    content: bytes,
  },
  '304': { description: 'If-None-Match matched. No body.', headers: { ETag: contentHeaders.ETag } },
  '416': {
    ...nativeErrorResponse,
    description: 'Unsatisfiable range: invalid_input with reason range_not_satisfiable.',
    headers: {
      'X-Request-Id': requestIdHeader,
      ETag: contentHeaders.ETag,
      'Content-Range': header('bytes */size'),
    },
  },
};
export const downloadHeaders = ['Range', 'If-Range', 'If-None-Match'].map((name) => ({
  name,
  in: 'header',
  schema: { type: 'string' },
  description:
    name === 'Range'
      ? 'Single bytes range; multi-range is unsupported. HEAD ignores Range.'
      : name === 'If-Range'
        ? 'Exact strong ETag; a mismatch causes a full response.'
        : 'Matching ETag returns 304, including HEAD.',
}));
const repository = {
  name: 'repository',
  in: 'path',
  required: true,
  schema: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' },
};
const query = (name: string, required = false) => ({
  name,
  in: 'query',
  required,
  schema: { type: 'string' },
});
const contentGet = (summary: string, parameters: readonly object[]) => ({
  summary,
  description:
    'Resolves the name on every request, then streams immutable bytes. Resume with Range and If-Range set to the returned ETag, or download by artifact id.',
  parameters: [...downloadHeaders, ...parameters],
  responses: contentResponses,
});
const healthStatusContent = { 'application/json': { schema: healthStatusSchema } };
export const supplementalPaths = {
  '/health/status': {
    get: {
      summary: 'Public load-balancer readiness without details; outside the request budget.',
      responses: {
        '200': { description: 'Ready to accept new transfers.', content: healthStatusContent },
        '503': {
          description: 'unavailable (dependency or ownership) or draining (graceful shutdown).',
          headers: { 'Retry-After': header('Seconds before the next probe.') },
          content: healthStatusContent,
        },
      },
    },
  },
  '/health/live': {
    get: {
      summary: 'Public process liveness; does not check dependencies.',
      responses: {
        '200': {
          description: 'Process is alive.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['status'],
                properties: { status: { type: 'string', enum: ['ok'] } },
              },
            },
          },
        },
      },
    },
  },
  '/api/v1/openapi.json': {
    get: {
      summary: 'Get this deployment API contract.',
      parameters: [
        {
          name: 'surface',
          in: 'query',
          description: 'Documentation view only; not filtered by caller permissions.',
          schema: { type: 'string', enum: apiSurfaces },
        },
      ],
      responses: {
        '200': {
          description: 'OpenAPI 3.0.3 document.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['openapi', 'info', 'paths'],
                properties: {
                  openapi: { type: 'string', enum: ['3.0.3'] },
                  info: { type: 'object' },
                  paths: { type: 'object' },
                },
              },
            },
          },
        },
      },
    },
  },
  '/api/v1/repositories/{repository}/packages/content': {
    parameters: [repository],
    get: contentGet(
      'Download a UPack resolved by version, SemVer range and stage; without either, the highest stable version.',
      packageQueryParameters,
    ),
  },
  '/api/v1/repositories/{repository}/asset/content': {
    parameters: [repository],
    get: contentGet('Download the current revision of a file path.', [query('path', true)]),
  },
};
import { packageQueryParameters } from './promotion-api.js';
import { apiSurfaces } from './api-surfaces.js';
import { healthStatusSchema } from './health.js';
