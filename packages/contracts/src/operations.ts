import { apiSurfaces, apiVisibilities } from './api-surfaces.js';
import type { ApiSurface, ApiVisibility } from './api-surfaces.js';
import { items, record, text } from './wire-values.js';
import { servicePermissionNames } from './service-api.js';
import { administrationPermissionNames } from './delegation-api.js';
import { backupPermissionNames } from './backup-wire.js';
import type { ApiMethod, OperationPolicy } from './operation-policy.js';

const methods = ['get', 'head', 'post', 'put', 'patch', 'delete'] as const;
const retries = [
  'read',
  'never-automatic',
  'idempotent',
  'idempotency-key',
  'compare-and-swap',
  'reconcile-upload',
  'reconcile-job',
] as const;
export const operationConditions = [
  'resource-state',
  'upload-owner',
  'job-owner',
  'reference-owner',
  'delegation-target-and-ceiling',
  'own-key',
] as const;
export type OperationCondition = (typeof operationConditions)[number];
const permissions = [
  ...servicePermissionNames,
  ...administrationPermissionNames,
  ...backupPermissionNames,
];
export interface OperationDescriptor {
  operationId: string;
  method: ApiMethod;
  path: string;
  summary: string;
  surface: ApiSurface;
  visibility: ApiVisibility;
  retry: OperationPolicy['retry'];
  requiredActions: readonly string[];
  conditions: readonly OperationCondition[];
}
export interface OperationPage {
  apiVersion: 'v1';
  documentVersion: string;
  gatewayRole: 'api' | 'reader';
  repository: string | null;
  advisory: true;
  items: readonly OperationDescriptor[];
  next: string | null;
}
export interface OperationQuery {
  repository?: string;
  surface?: ApiSurface;
  after?: string;
  limit?: number;
}
function member<T extends string>(value: unknown, options: readonly T[]): T {
  const result = options.find((entry) => entry === value);
  if (!result) throw new Error('Invalid operation classification');
  return result;
}
function identifier(value: unknown): string {
  const id = text(value);
  if (!/^[A-Za-z][A-Za-z0-9]{0,95}$/.test(id)) throw new Error('Invalid operation identifier');
  return id;
}
export function readOperationPage(value: unknown): OperationPage {
  const r = record(value);
  if (r['apiVersion'] !== 'v1' || r['advisory'] !== true) throw new Error('Invalid operation page');
  const repository = r['repository'] === null ? null : text(r['repository']);
  if (repository !== null && !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(repository))
    throw new Error('Invalid repository');
  const rows = items(r['items']);
  if (rows.length > 100) throw new Error('Operation page too large');
  let previous = '';
  const result = rows.map((value): OperationDescriptor => {
    const row = record(value),
      operationId = identifier(row['operationId']);
    if (operationId <= previous) throw new Error('Unordered operation page');
    previous = operationId;
    const path = text(row['path']),
      summary = text(row['summary']);
    if (!path.startsWith('/') || path.length > 512 || summary.length > 1024)
      throw new Error('Invalid operation description');
    const requiredActions = items(row['requiredActions']).map((value) =>
      member(value, permissions),
    );
    const conditions = items(row['conditions']).map((value) => member(value, operationConditions));
    if (
      requiredActions.length > permissions.length ||
      new Set(requiredActions).size !== requiredActions.length ||
      conditions.length > operationConditions.length ||
      new Set(conditions).size !== conditions.length
    )
      throw new Error('Invalid operation requirements');
    return {
      operationId,
      path,
      summary,
      method: member(row['method'], methods),
      surface: member(row['surface'], apiSurfaces),
      visibility: member(row['visibility'], apiVisibilities),
      retry: member(row['retry'], retries),
      requiredActions,
      conditions,
    };
  });
  const next = r['next'] === null ? null : identifier(r['next']);
  if (next !== null && (!result.length || next !== previous))
    throw new Error('Invalid operation cursor');
  const documentVersion = text(r['documentVersion']);
  if (!/^\d+\.\d+\.\d+$/.test(documentVersion)) throw new Error('Invalid document version');
  return {
    apiVersion: 'v1',
    documentVersion,
    gatewayRole: member(r['gatewayRole'], ['api', 'reader']),
    repository,
    advisory: true,
    items: result,
    next,
  };
}
const identifierSchema = { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9]{0,95}$' };
export const operationPageSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'apiVersion',
    'documentVersion',
    'gatewayRole',
    'repository',
    'advisory',
    'items',
    'next',
  ],
  properties: {
    apiVersion: { type: 'string', enum: ['v1'] },
    documentVersion: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+$' },
    gatewayRole: { type: 'string', enum: ['api', 'reader'] },
    repository: { type: 'string', nullable: true, pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' },
    advisory: { type: 'boolean', enum: [true] },
    items: {
      type: 'array',
      maxItems: 100,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'operationId',
          'method',
          'path',
          'summary',
          'surface',
          'visibility',
          'retry',
          'requiredActions',
          'conditions',
        ],
        properties: {
          operationId: identifierSchema,
          method: { type: 'string', enum: methods },
          path: { type: 'string', maxLength: 512, pattern: '^/' },
          summary: { type: 'string', maxLength: 1024 },
          surface: { type: 'string', enum: apiSurfaces },
          visibility: { type: 'string', enum: apiVisibilities },
          retry: { type: 'string', enum: retries },
          requiredActions: {
            type: 'array',
            uniqueItems: true,
            maxItems: permissions.length,
            items: { type: 'string', enum: permissions },
          },
          conditions: {
            type: 'array',
            uniqueItems: true,
            maxItems: operationConditions.length,
            items: { type: 'string', enum: operationConditions },
          },
        },
      },
    },
    next: { ...identifierSchema, nullable: true },
  },
} as const;
export const operationPaths = {
  '/api/v1/operations': {
    get: {
      summary:
        'Discover operations visible to this credential and gateway; advisory, not an authorization receipt',
      parameters: [
        {
          name: 'repository',
          in: 'query',
          schema: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' },
        },
        { name: 'surface', in: 'query', schema: { type: 'string', enum: apiSurfaces } },
        { name: 'after', in: 'query', schema: identifierSchema },
        {
          name: 'limit',
          in: 'query',
          schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
        },
      ],
      responses: {
        '200': {
          description:
            'Only applicable operations. Resource existence, ownership, CAS, and delegation targets remain checked by each request.',
          content: { 'application/json': { schema: operationPageSchema } },
        },
      },
    },
  },
};
