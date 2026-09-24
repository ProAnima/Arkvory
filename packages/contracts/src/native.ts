import { catalogPaths } from './catalog-api.js';
import { identityPaths } from './identity-api.js';
import { readinessSchema } from './health.js';
import { servicePaths } from './service-api.js';
import { supplementalPaths, nativeErrorSchema } from './http-contract.js';
import { composeApiPaths } from './openapi-compose.js';
import { delegationPaths } from './delegation-api.js';
import { repositoryPaths } from './repositories.js';
export const descriptorSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'size', 'sha256'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 240 },
    size: { type: 'string', pattern: '^(0|[1-9][0-9]{0,15})$' },
    sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    labels: { type: 'array', maxItems: 32, items: { type: 'string', maxLength: 64 } },
    metadata: {
      type: 'object',
      maxProperties: 32,
      additionalProperties: { type: 'string', maxLength: 1024 },
    },
  },
} as const;

export interface UploadResponse {
  id: string;
  repository: string;
  status: 'pending' | 'available' | 'cancelled';
  createdAt: string;
  expiresAt: string;
  descriptor: {
    name: string;
    size: string;
    sha256: string;
    labels: readonly string[];
    metadata: Readonly<Record<string, string>>;
  };
}

export const uploadSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'repository', 'status', 'createdAt', 'expiresAt', 'descriptor'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    repository: { type: 'string' },
    status: { type: 'string', enum: ['pending', 'available', 'cancelled'] },
    createdAt: { type: 'string', format: 'date-time' },
    expiresAt: { type: 'string', format: 'date-time' },
    descriptor: descriptorSchema,
  },
} as const;

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
const jsonResponse = {
  description: 'Upload or artifact state',
  content: { 'application/json': { schema: uploadSchema } },
};
const errorResponse = {
  description: 'Error with code, message, requestId; 503 responses include Retry-After',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        required: ['code', 'message', 'requestId'],
        properties: {
          code: { type: 'string' },
          message: { type: 'string' },
          requestId: { type: 'string' },
        },
      },
    },
  },
};
const responses = { '200': jsonResponse, default: errorResponse };
const byteResponses = {
  '200': {
    description: 'Original bytes; Content-Length, ETag, Accept-Ranges',
    content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
  },
  '206': { description: 'Single byte range; Content-Range, Content-Length, ETag' },
  '304': { description: 'Matching If-None-Match' },
  '416': { description: 'Unsatisfiable range; Content-Range: bytes */size' },
  default: errorResponse,
};

const baseDocument = {
  openapi: '3.0.3',
  info: {
    title: 'ProAnima Depot Native Core',
    version: '0.2.0',
    description:
      'Writer API. Read gateways support GET/HEAD only; authenticated mutation requests receive 405 with Allow: GET, HEAD and code read_only. Readiness reports role and shared download lease status.',
  },
  security: [{ serviceKey: [] }],
  components: {
    securitySchemes: {
      serviceKey: { type: 'http', scheme: 'bearer', description: 'Service key or account session' },
    },
  },
  paths: {
    '/health/ready': {
      get: {
        summary: 'Authenticated readiness and aggregate gateway transfer diagnostics',
        responses: {
          '200': {
            description:
              'Ready; counters reset on process restart, byte grants are not delivery receipts',
            content: { 'application/json': { schema: readinessSchema } },
          },
          default: errorResponse,
        },
      },
    },
    ...catalogPaths,
    ...identityPaths,
    ...servicePaths,
    '/api/v1/repositories/{repository}/uploads': {
      parameters: [repositoryParameter],
      post: {
        summary: 'Reserve an immutable upload',
        parameters: [
          {
            name: 'Idempotency-Key',
            in: 'header',
            required: true,
            schema: { type: 'string', maxLength: 128 },
          },
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: descriptorSchema } },
        },
        responses: { '201': jsonResponse, default: errorResponse },
      },
    },
    '/api/v1/repositories/{repository}/uploads/{id}': {
      parameters: [repositoryParameter, idParameter],
      get: { summary: 'Read own upload state', responses },
      delete: {
        summary: 'Cancel own pending upload; reservation retained until offline GC',
        responses,
      },
    },
    '/api/v1/repositories/{repository}/uploads/{id}/content': {
      parameters: [repositoryParameter, idParameter],
      put: {
        summary: 'Stream and publish entire file; partial requests must be retried from byte zero',
        requestBody: {
          required: true,
          content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
        },
        responses,
      },
    },
    '/api/v1/repositories/{repository}/uploads/{id}/complete': {
      parameters: [repositoryParameter, idParameter],
      post: { summary: 'Idempotent completion or recovery after blob persistence', responses },
    },
    '/api/v1/repositories/{repository}/artifacts': {
      parameters: [repositoryParameter],
      get: {
        summary: 'List available artifacts ordered by immutable ID',
        parameters: [
          { name: 'after', in: 'query', schema: { type: 'string', format: 'uuid' } },
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
          },
        ],
        responses: {
          '200': {
            description: 'Page; pass next as after, null marks end',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    items: { type: 'array', items: uploadSchema },
                    next: { type: 'string', nullable: true },
                  },
                },
              },
            },
          },
          default: errorResponse,
        },
      },
    },
    '/api/v1/repositories/{repository}/artifacts/{id}': {
      parameters: [repositoryParameter, idParameter],
      get: { summary: 'Read published metadata', responses },
    },
    '/api/v1/repositories/{repository}/artifacts/{id}/content': {
      parameters: [repositoryParameter, idParameter],
      get: {
        summary: 'Download immutable content',
        parameters: ['Range', 'If-Range', 'If-None-Match'].map((name) => ({
          name,
          in: 'header',
          schema: { type: 'string' },
        })),
        responses: byteResponses,
      },
      head: {
        summary: 'Read content headers without bytes; Range is ignored',
        responses: byteResponses,
      },
    },
  },
};
const composed = composeApiPaths({
  ...baseDocument.paths,
  ...supplementalPaths,
  ...delegationPaths,
  ...repositoryPaths,
});
export const apiOperations = composed.operations;
export const openApiDocument = {
  ...baseDocument,
  info: { ...baseDocument.info, title: 'ProAnima Depot API', version: '0.6.1' },
  components: {
    ...baseDocument.components,
    schemas: { NativeError: nativeErrorSchema },
    securitySchemes: {
      ...baseDocument.components.securitySchemes,
      legacyApiKey: {
        type: 'apiKey',
        in: 'header',
        name: 'X-ApiKey',
        description: 'Legacy download routes only.',
      },
      legacyBasic: {
        type: 'http',
        scheme: 'basic',
        description:
          'Legacy downloads: literal username api, password is the API key. User/password authentication is not supported.',
      },
    },
  },
  paths: composed.paths,
};
