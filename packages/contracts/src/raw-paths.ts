import { contentGet } from './http-contract.js';

/* OpenAPI of raw files (ADR 0064); policies and the reader are in raw-api.ts. */
const repositoryParameter = {
  name: 'repository',
  in: 'path',
  required: true,
  schema: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' },
};
const pathParameter = {
  name: 'assetPath',
  in: 'path',
  required: true,
  description:
    'File path; may contain slashes (folders). No empty, "." or ".." segments, backslash or colon.',
  schema: { type: 'string', minLength: 1, maxLength: 1024 },
};
const rawFileSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['path', 'revision', 'created', 'artifact'],
  properties: {
    path: { type: 'string' },
    revision: { type: 'integer', minimum: 1 },
    created: { type: 'boolean' },
    artifact: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'size', 'sha256'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        size: { type: 'string', pattern: '^(0|[1-9][0-9]{0,18})$' },
        sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      },
    },
  },
} as const;
const rawFileContent = { 'application/json': { schema: rawFileSchema } };

export const rawPaths = {
  '/api/v1/repositories/{repository}/raw/{assetPath}': {
    parameters: [repositoryParameter, pathParameter],
    put: {
      summary:
        'Store the request body as the new revision of a file path in one request; the same bytes again add no revision',
      description:
        'For scripts and CI (curl -T). Send X-Checksum-Sha256 to stream the bytes straight to storage; without it they are staged and hashed first. For very large files prefer the resumable upload of the SDK or arkvoryctl put.',
      parameters: [
        {
          name: 'X-Checksum-Sha256',
          in: 'header',
          required: false,
          description: 'SHA-256 of the body (64 hex digits); a mismatch stores nothing (422).',
          schema: { type: 'string', pattern: '^[a-fA-F0-9]{64}$' },
        },
        {
          name: 'If-None-Match',
          in: 'header',
          required: false,
          description: '"*": store only when the path does not exist yet (409 already_exists).',
          schema: { type: 'string', enum: ['*'] },
        },
      ],
      requestBody: {
        required: true,
        content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
      },
      responses: {
        '200': { description: 'The path already held these bytes.', content: rawFileContent },
        '201': { description: 'A new revision of the path.', content: rawFileContent },
      },
    },
    get: contentGet('Download the current revision of a file path (raw).', []),
  },
} as const;
