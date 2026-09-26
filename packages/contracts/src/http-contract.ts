export const nativeErrorSchema = {
  type: 'object',
  required: ['code', 'message', 'requestId'],
  properties: {
    code: { type: 'string' },
    message: { type: 'string' },
    requestId: { type: 'string' },
  },
} as const;
const header = (description: string) => ({ description, schema: { type: 'string' } });
export const requestIdHeader = header('Server-generated request ID.');
export const nativeErrorResponse = {
  description: 'Native error envelope; no stack traces or credentials.',
  headers: { 'X-Request-Id': requestIdHeader },
  content: { 'application/json': { schema: nativeErrorSchema } },
};
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
    description: 'Unsatisfiable range. Empty body.',
    headers: { ...contentHeaders, 'Content-Range': header('bytes */size') },
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
const legacyGet = (summary: string, parameters: readonly object[] = []) => ({
  summary,
  description:
    'Implemented original-byte download subset. Errors use the Arkvory native envelope; complete ProGet compatibility is not claimed. Query-string keys do not authenticate.',
  parameters: [...downloadHeaders, ...parameters],
  responses: contentResponses,
});
export const supplementalPaths = {
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
  '/api/packages/{repository}/download': {
    parameters: [repository],
    get: legacyGet('Download an exact UPack via Common Packages API.', [
      query('group'),
      query('name', true),
      query('version', true),
    ]),
  },
  '/upack/{repository}/download/{packagePath}': {
    parameters: [
      repository,
      {
        name: 'packagePath',
        in: 'path',
        required: true,
        description:
          'Catch-all path: [group/]name/version; with latest present: [group/]name. Encode each segment separately and preserve / separators; ordinary single-segment SDK generation is insufficient.',
        schema: { type: 'string', minLength: 1 },
        'x-arkvory-catch-all': true,
      },
    ],
    get: legacyGet('Download an exact or latest Universal Package.', [
      {
        ...query('latest'),
        description:
          'Presence selects latest SemVer; any string value. Omit version from packagePath.',
      },
    ]),
  },
  '/endpoints/{repository}/content/{assetPath}': {
    parameters: [
      repository,
      {
        name: 'assetPath',
        in: 'path',
        required: true,
        description:
          'Catch-all logical asset path. Encode each segment separately and preserve / separators.',
        schema: { type: 'string', minLength: 1 },
        'x-arkvory-catch-all': true,
      },
    ],
    get: legacyGet('Download current asset bytes.'),
  },
};
import { apiSurfaces } from './api-surfaces.js';
