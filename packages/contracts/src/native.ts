import { storagePolicyPaths } from './storage-policy.js';
import { cleanupPaths } from './cleanup.js';
import { updatePaths } from './updates-api.js';
import { retentionPaths, deletionOperation } from './retention.js';
import { attachmentPaths } from './attachments.js';
import { catalogPaths } from './catalog-api.js';
import { identityPaths } from './identity-api.js';
import { securityAuditPaths } from './security-audit.js';
import { readinessSchema } from './health.js';
import { servicePaths } from './service-api.js';
import { supplementalPaths, nativeErrorSchema, nativeErrorResponse } from './http-contract.js';
import { composeApiPaths } from './openapi-compose.js';
import { delegationPaths } from './delegation-api.js';
import { repositoryPaths } from './repositories.js';
import { operationPaths } from './operations.js';
import { promotionPaths } from './promotion-api.js';
import { metricsPaths } from './metrics.js';
import { backupPaths } from './backup-api.js';
import { mirrorPaths } from './mirror-api.js';
import type { ApiSurface } from './api-surfaces.js';
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
  ...nativeErrorResponse,
  description:
    'Error envelope; 503 responses include Retry-After and retryAfterSeconds; 500 internal does not',
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
    title: 'ProAnima Arkvory Native Core',
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
    ...securityAuditPaths,
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
  ...metricsPaths,
  ...delegationPaths,
  ...repositoryPaths,
  ...operationPaths,
  ...attachmentPaths,
  ...promotionPaths,
  ...retentionPaths,
  ...storagePolicyPaths,
  ...cleanupPaths,
  ...updatePaths,
  ...backupPaths,
  ...mirrorPaths,
  ['/api/v1/repositories/{repository}/artifacts/{id}']: {
    ...baseDocument.paths['/api/v1/repositories/{repository}/artifacts/{id}'],
    delete: deletionOperation,
  },
});
export const apiOperations = composed.operations;
export const openApiDocument = {
  ...baseDocument,
  info: { ...baseDocument.info, title: 'ProAnima Arkvory API', version: '0.15.0' },
  components: {
    ...baseDocument.components,
    schemas: { NativeError: nativeErrorSchema },
    securitySchemes: baseDocument.components.securitySchemes,
  },
  paths: composed.paths,
};

/** A documentation view, not an ACL-filtered specification. Existing full spec stays available. */
export function openApiSurface(surface: ApiSurface) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const operation of apiOperations) {
    if (operation.surface !== surface) continue;
    const source = openApiDocument.paths[operation.path];
    if (!source) throw new Error('Missing documented path');
    const target = paths[operation.path] ?? {};
    if (source['parameters']) target['parameters'] = source['parameters'];
    target[operation.method] = source[operation.method];
    paths[operation.path] = target;
  }
  return { ...openApiDocument, paths, 'x-arkvory-document-surface': surface };
}
