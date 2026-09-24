import { record, text, integer, items } from './wire-values.js';
import { serviceBindingSchema, readServiceBindings } from './service-api.js';
export const administrationPermissionNames = [
  'service-account.read',
  'service-account.manage',
  'policy.read',
  'policy.manage',
  'credential.read',
  'credential.manage',
  'service-audit.read',
] as const;
export type AdministrationPermission = (typeof administrationPermissionNames)[number];
export function readDelegation(value: unknown) {
  const r = record(value);
  if (typeof r['enabled'] !== 'boolean') throw new Error('Invalid delegation state');
  const actions = items(r['actions']).map((v) => {
    const action = administrationPermissionNames.find((a) => a === v);
    if (!action) throw new Error('Invalid administration action');
    return action;
  });
  if (actions.length > 7 || (r['enabled'] && !actions.length))
    throw new Error('Invalid delegation actions');
  const revision = integer(r['revision']);
  if (revision < 1 || revision > 2147483647) throw new Error('Invalid delegation revision');
  return {
    keyId: text(r['keyId']),
    targetAccountId: text(r['targetAccountId']),
    enabled: r['enabled'],
    revision,
    actions,
    ceiling: readServiceBindings(r['ceiling'], 16),
  };
}
export function readDelegations(value: unknown) {
  const rows = items(record(value)['items']);
  if (rows.length > 64) throw new Error('Too many delegations');
  return rows.map(readDelegation);
}
const id = { type: 'string', format: 'uuid' };
const revision = { type: 'integer', minimum: 1, maximum: 2147483647 };
const ceiling = { ...serviceBindingSchema, maxItems: 16 };
const actions = {
  type: 'array',
  maxItems: 7,
  uniqueItems: true,
  items: { type: 'string', enum: administrationPermissionNames },
};
const delegation = {
  type: 'object',
  required: ['keyId', 'targetAccountId', 'enabled', 'revision', 'actions', 'ceiling'],
  properties: {
    keyId: id,
    targetAccountId: id,
    enabled: { type: 'boolean' },
    revision,
    actions,
    ceiling,
  },
};
const parameter = (name: string) => ({ name, in: 'path', required: true, schema: id });
const response = (schema: object) => ({
  '200': {
    description: 'Delegation state. Disabled records retain revision to prevent stale recreation.',
    content: { 'application/json': { schema } },
  },
});
const body = (schema: object) => ({ required: true, content: { 'application/json': { schema } } });
export const delegationPaths = {
  '/api/v1/api-keys/{id}/delegations': {
    parameters: [parameter('id')],
    get: {
      summary:
        'Bootstrap or this key holder: inspect bounded delegations including disabled records.',
      responses: response({
        type: 'object',
        required: ['items'],
        properties: { items: { type: 'array', maxItems: 64, items: delegation } },
      }),
    },
  },
  '/api/v1/api-keys/{id}/delegations/{accountId}': {
    parameters: [parameter('id'), parameter('accountId')],
    put: {
      summary: 'Bootstrap: set exact target/actions/ceiling; no recursive delegation.',
      requestBody: body({
        type: 'object',
        additionalProperties: false,
        required: ['expectedRevision', 'actions', 'ceiling'],
        properties: {
          expectedRevision: { ...revision, minimum: 0, maximum: 2147483646 },
          actions: { ...actions, minItems: 1 },
          ceiling,
        },
      }),
      responses: response(delegation),
    },
    delete: {
      summary:
        'Bootstrap: disable delegation using CAS; does not revoke already activated issued keys.',
      requestBody: body({
        type: 'object',
        additionalProperties: false,
        required: ['expectedRevision'],
        properties: { expectedRevision: { ...revision, maximum: 2147483646 } },
      }),
      responses: response(delegation),
    },
  },
};
