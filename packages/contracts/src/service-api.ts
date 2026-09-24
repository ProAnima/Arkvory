import { record, text, integer, items } from './wire-values.js';

export const servicePermissionNames = [
  'repository.read',
  'artifact.read',
  'artifact.list',
  'content.read',
  'upload.create',
  'upload.read',
  'upload.write',
  'upload.complete',
  'upload.cancel',
  'job.read',
  'package.read',
  'package.publish',
  'asset.read',
  'asset.write',
  'asset.restore',
  'annotation.read',
  'annotation.write',
  'reference.write',
  'audit.read',
] as const;
export interface ServiceBindingResponse {
  resource: { kind: 'repository'; id: string };
  actions: readonly (typeof servicePermissionNames)[number][];
}
export interface ServiceAccountResponse {
  id: string;
  name: string;
  enabled: boolean;
  revision: number;
  bindings: readonly ServiceBindingResponse[];
  createdAt: string;
}
export interface ApiKeyResponse {
  id: string;
  accountId: string;
  name: string;
  state: 'pending' | 'active' | 'revoked';
  bindings: readonly ServiceBindingResponse[];
  createdAt: string;
  expiresAt: string;
  activationExpiresAt: string;
  rotatedFrom: string | null;
}
function date(value: unknown): string {
  const v = text(value);
  if (!Number.isFinite(Date.parse(v))) throw new Error('Invalid timestamp');
  return v;
}
export function readServiceBindings(value: unknown, max = 64): readonly ServiceBindingResponse[] {
  const rows = items(value);
  if (rows.length > max) throw new Error('Too many bindings');
  return rows.map((entry) => {
    const r = record(entry),
      resource = record(r['resource']);
    if (resource['kind'] !== 'repository') throw new Error('Unsupported service resource');
    const actions = items(r['actions']).map((raw) => {
      const permission = servicePermissionNames.find((p) => p === raw);
      if (!permission) throw new Error('Unsupported service permission');
      return permission;
    });
    if (actions.length === 0 || actions.length > servicePermissionNames.length)
      throw new Error('Invalid permissions');
    return { resource: { kind: 'repository', id: text(resource['id']) }, actions };
  });
}
export function readServiceAccount(value: unknown): ServiceAccountResponse {
  const r = record(value);
  if (typeof r['enabled'] !== 'boolean') throw new Error('Invalid enabled');
  return {
    id: text(r['id']),
    name: text(r['name']),
    enabled: r['enabled'],
    revision: integer(r['revision']),
    bindings: readServiceBindings(r['bindings']),
    createdAt: date(r['createdAt']),
  };
}
export function readApiKey(value: unknown): ApiKeyResponse {
  const r = record(value),
    state = r['state'];
  if (state !== 'pending' && state !== 'active' && state !== 'revoked')
    throw new Error('Invalid key state');
  return {
    id: text(r['id']),
    accountId: text(r['accountId']),
    name: text(r['name']),
    state,
    bindings: readServiceBindings(r['bindings']),
    createdAt: date(r['createdAt']),
    expiresAt: date(r['expiresAt']),
    activationExpiresAt: date(r['activationExpiresAt']),
    rotatedFrom: r['rotatedFrom'] === null ? null : text(r['rotatedFrom']),
  };
}
export function readKeyIssue(value: unknown) {
  const r = record(value);
  return {
    key: readApiKey(r['key']),
    ...(r['secret'] === undefined ? {} : { secret: text(r['secret']) }),
  };
}
export function readServicePage<T>(value: unknown, parse: (row: unknown) => T) {
  const r = record(value);
  const rows = items(r['items']);
  if (rows.length > 50) throw new Error('Invalid service page');
  return { items: rows.map(parse), next: r['next'] === null ? null : text(r['next']) };
}
export const serviceBindingSchema = {
  type: 'array',
  maxItems: 64,
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['resource', 'actions'],
    properties: {
      resource: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'id'],
        properties: {
          kind: { type: 'string', enum: ['repository'] },
          id: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' },
        },
      },
      actions: {
        type: 'array',
        minItems: 1,
        maxItems: servicePermissionNames.length,
        uniqueItems: true,
        items: { type: 'string', enum: servicePermissionNames },
      },
    },
  },
} as const;
const id = { type: 'string', format: 'uuid' };
const timestamp = { type: 'string', format: 'date-time' };
const name = { type: 'string', pattern: '^[a-zA-Z0-9_.-]{3,64}$' };
const rev = { type: 'integer', minimum: 1, maximum: 2147483646 };
export const serviceAccountSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'enabled', 'revision', 'bindings', 'createdAt'],
  properties: {
    id,
    name,
    enabled: { type: 'boolean' },
    revision: { ...rev, maximum: 2147483647 },
    bindings: serviceBindingSchema,
    createdAt: timestamp,
  },
};
export const apiKeySchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'accountId',
    'name',
    'state',
    'bindings',
    'createdAt',
    'expiresAt',
    'activationExpiresAt',
    'rotatedFrom',
  ],
  properties: {
    id,
    accountId: id,
    name,
    state: { type: 'string', enum: ['pending', 'active', 'revoked'] },
    bindings: serviceBindingSchema,
    createdAt: timestamp,
    expiresAt: timestamp,
    activationExpiresAt: timestamp,
    rotatedFrom: { ...id, nullable: true },
  },
};
const accountBody = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'bindings'],
  properties: { name, bindings: serviceBindingSchema },
};
const keyBody = { ...accountBody, properties: { ...accountBody.properties, expiresAt: timestamp } };
const updateBody = {
  type: 'object',
  additionalProperties: false,
  required: ['expectedRevision', 'enabled'],
  properties: { expectedRevision: rev, enabled: { type: 'boolean' } },
};
const policyBody = {
  type: 'object',
  additionalProperties: false,
  required: ['expectedRevision', 'bindings'],
  properties: { expectedRevision: rev, bindings: serviceBindingSchema },
};
const pageSchema = (schema: object) => ({
  type: 'object',
  required: ['items', 'next'],
  properties: {
    items: { type: 'array', maxItems: 50, items: schema },
    next: { ...id, nullable: true },
  },
});
const issueSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['key'],
  properties: { key: apiKeySchema, secret: { type: 'string', readOnly: true } },
};
const auditSchema = {
  type: 'object',
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      maxItems: 100,
      items: {
        type: 'object',
        required: ['sequence', 'actor', 'action', 'accountId', 'keyId', 'occurredAt'],
        properties: {
          sequence: { type: 'string' },
          actor: { type: 'string' },
          action: { type: 'string' },
          accountId: id,
          keyId: { ...id, nullable: true },
          occurredAt: timestamp,
        },
      },
    },
  },
};
const error = {
  description:
    'code, message and requestId; 400 invalid input, 401 credential, 403 scope, 404 missing, 409 revision/idempotency, 503 unavailable, 507 capacity',
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
const parameter = (name: string) => ({ name, in: 'path', required: true, schema: id });
const after = { name: 'after', in: 'query', schema: id };
const idempotency = {
  name: 'Idempotency-Key',
  in: 'header',
  required: true,
  schema: { type: 'string', maxLength: 128 },
};
function operation(
  operationId: string,
  schema: object | undefined,
  body?: object,
  status = '200',
  authority = 'local-service-bootstrap',
) {
  return {
    operationId,
    tags: ['Service access'],
    'x-depot-authority': authority,
    ...(body
      ? { requestBody: { required: true, content: { 'application/json': { schema: body } } } }
      : {}),
    responses: {
      [status]: {
        description: status === '204' ? 'Completed' : 'Result',
        ...(schema ? { content: { 'application/json': { schema } } } : {}),
      },
      default: error,
    },
  };
}
export const servicePaths = {
  '/api/v1/service-accounts': {
    get: {
      ...operation('listServiceAccounts', pageSchema(serviceAccountSchema)),
      parameters: [after],
    },
    post: operation('createServiceAccount', serviceAccountSchema, accountBody, '201'),
  },
  '/api/v1/service-accounts/{id}': {
    parameters: [parameter('id')],
    get: operation('getServiceAccount', serviceAccountSchema),
    patch: operation('updateServiceAccount', serviceAccountSchema, updateBody),
  },
  '/api/v1/service-accounts/{id}/policy': {
    parameters: [parameter('id')],
    get: operation('getServicePolicy', serviceAccountSchema),
    put: operation('setServicePolicy', serviceAccountSchema, policyBody),
  },
  '/api/v1/service-accounts/{id}/keys': {
    parameters: [parameter('id')],
    get: { ...operation('listServiceKeys', pageSchema(apiKeySchema)), parameters: [after] },
    post: {
      ...operation('issueServiceKey', issueSchema, keyBody, '201'),
      parameters: [idempotency],
      responses: {
        ...operation('issueServiceKey', issueSchema, keyBody, '201').responses,
        '200': {
          description: 'Idempotent replay: metadata only',
          content: { 'application/json': { schema: issueSchema } },
        },
      },
    },
  },
  '/api/v1/service-accounts/{id}/audit': {
    parameters: [parameter('id')],
    get: {
      ...operation('getServiceAudit', auditSchema),
      parameters: [
        {
          name: 'after',
          in: 'query',
          schema: { type: 'string', pattern: '^(0|[1-9][0-9]{0,17})$' },
        },
      ],
    },
  },
  '/api/v1/api-keys/{id}': {
    parameters: [parameter('id')],
    get: operation('getServiceKey', apiKeySchema),
  },
  '/api/v1/api-keys/{id}/rotate': {
    parameters: [parameter('id')],
    post: {
      ...operation('rotateServiceKey', issueSchema, keyBody, '201'),
      parameters: [idempotency],
      responses: {
        ...operation('rotateServiceKey', issueSchema, keyBody, '201').responses,
        '200': {
          description: 'Idempotent replay: metadata only',
          content: { 'application/json': { schema: issueSchema } },
        },
      },
    },
  },
  '/api/v1/api-keys/{id}/revoke': {
    parameters: [parameter('id')],
    post: operation('revokeServiceKey', undefined, undefined, '204'),
  },
  '/api/v1/auth/activate-key': {
    post: operation(
      'activateServiceKey',
      undefined,
      undefined,
      '204',
      'pending-or-active-credential',
    ),
  },
  '/api/v1/auth/permissions': {
    get: operation(
      'getOwnPermissions',
      {
        type: 'object',
        required: ['id', 'profile', 'bindings', 'serviceAdministration'],
        properties: {
          id: { type: 'string' },
          profile: { type: 'string', enum: ['legacy', 'managed'] },
          bindings: { ...serviceBindingSchema, maxItems: 10000 },
          serviceAdministration: { type: 'boolean' },
          credentialId: { type: 'string', format: 'uuid', nullable: true },
        },
      },
      undefined,
      '200',
      'authenticated',
    ),
  },
  '/api/v1/capabilities': {
    get: operation(
      'getCapabilities',
      {
        type: 'object',
        required: ['apiVersions', 'gatewayRole', 'features', 'limits'],
        properties: {
          apiVersions: { type: 'array', items: { type: 'string' } },
          gatewayRole: { type: 'string', enum: ['api', 'reader'] },
          features: { type: 'object', additionalProperties: { type: 'boolean' } },
          limits: {
            type: 'object',
            properties: {
              maxObjectBytes: { type: 'string' },
              partBytes: { type: 'integer' },
              maxPageSize: { type: 'integer' },
            },
          },
        },
      },
      undefined,
      '200',
      'authenticated',
    ),
  },
};
