import { storageOperations, attachmentOperations } from './storage-operation-policies.js';
import { catalogOperations } from './catalog-operation-policies.js';
import { promotionOperations } from './promotion-api.js';
import { mirrorOperations } from './mirror-api.js';
import { downloadLinkOperationPolicies } from './download-link-api.js';
import { rawOperationPolicies } from './raw-api.js';
import { accountAdministrationOperations } from './account-operation-policies.js';
import { backupOperations } from './backup-api.js';
import { feedbackOperations } from './feedback-api.js';
import { updateOperations } from './updates-api.js';
import type { BackupPermissionName } from './backup-wire.js';
import type { servicePermissionNames } from './service-api.js';
import type { AdministrationPermission } from './delegation-api.js';
type ServicePermission = (typeof servicePermissionNames)[number];

export type ApiMethod = 'get' | 'head' | 'post' | 'put' | 'patch' | 'delete';
export interface OperationPolicy {
  operationId: string;
  tag: string;
  access:
    | {
        kind:
          | 'public'
          | 'authenticated'
          | 'account-session'
          | 'administrator'
          | 'service-bootstrap'
          | 'bootstrap-or-own-key'
          | 'pending-or-active-key';
      }
    | {
        kind: 'repository-discovery';
        action: 'repository.read';
        resource: 'visible-repositories' | 'path.repository';
        legacy: 'own-nonempty-grants';
        invisible: 'omit' | 'not_found';
      }
    | { kind: 'system'; action: BackupPermissionName }
    | {
        kind: 'service-administration';
        action: AdministrationPermission;
        resource: 'visible-accounts' | 'path.id' | 'key.accountId';
        bootstrapAlternative: true;
      }
    | {
        kind: 'repository';
        resource: 'path.repository' | 'job.repository';
        actions: readonly ServicePermission[];
        legacy: readonly ('read' | 'write')[] | null;
        owner?: 'upload' | 'job' | 'reference';
      };
  retry:
    | 'read'
    | 'never-automatic'
    | 'idempotent'
    | 'idempotency-key'
    | 'compare-and-swap'
    | 'reconcile-upload'
    | 'reconcile-job';
}
const repo = (
  actions: readonly ServicePermission[],
  legacy: readonly ('read' | 'write')[] | null,
  owner?: 'upload' | 'job' | 'reference',
): OperationPolicy['access'] => ({
  kind: 'repository',
  resource: owner === 'job' ? 'job.repository' : 'path.repository',
  actions,
  legacy,
  ...(owner ? { owner } : {}),
});
const root = '/api/v1/repositories/{repository}';
const policies: Record<string, Partial<Record<ApiMethod, OperationPolicy>>> = {};
function add(
  path: string,
  method: ApiMethod,
  operationId: string,
  tag: string,
  access: OperationPolicy['access'],
  retry: OperationPolicy['retry'] = 'never-automatic',
) {
  const entry = policies[path] ?? {};
  if (entry[method]) throw new Error(`Duplicate operation policy: ${method} ${path}`);
  entry[method] = { operationId, tag, access, retry };
  policies[path] = entry;
}
function data(
  path: string,
  method: ApiMethod,
  id: string,
  tag: string,
  actions: readonly ServicePermission[],
  legacy: readonly ('read' | 'write')[] | null,
  retry: OperationPolicy['retry'],
  owner?: 'upload' | 'job' | 'reference',
) {
  add(path, method, id, tag, repo(actions, legacy, owner), retry);
}
add('/health/live', 'get', 'getLiveness', 'System', { kind: 'public' }, 'read');
add('/health/status', 'get', 'getReadinessStatus', 'System', { kind: 'public' }, 'read');
for (const [tag, operations] of [
  ['Updates', updateOperations],
  ['Feedback', feedbackOperations],
] as const)
  for (const [path, method, id, kind, retry] of operations)
    add(`/api/v1${path}`, method, id, tag, { kind }, retry);
add(
  '/api/v1/repositories',
  'get',
  'listRepositories',
  'Repositories',
  {
    kind: 'repository-discovery',
    action: 'repository.read',
    resource: 'visible-repositories',
    legacy: 'own-nonempty-grants',
    invisible: 'omit',
  },
  'read',
);
add(
  root,
  'get',
  'getRepository',
  'Repositories',
  {
    kind: 'repository-discovery',
    action: 'repository.read',
    resource: 'path.repository',
    legacy: 'own-nonempty-grants',
    invisible: 'not_found',
  },
  'read',
);
add('/health/ready', 'get', 'getReadiness', 'System', { kind: 'authenticated' }, 'read');
add('/health/metrics', 'get', 'getMetrics', 'System', { kind: 'authenticated' }, 'read');
add('/api/v1/openapi.json', 'get', 'getOpenApi', 'System', { kind: 'authenticated' }, 'read');
add('/api/v1/capabilities', 'get', 'getCapabilities', 'System', { kind: 'authenticated' }, 'read');
add(
  '/api/v1/operations',
  'get',
  'listVisibleOperations',
  'System',
  { kind: 'authenticated' },
  'read',
);
add(
  '/api/v1/auth/permissions',
  'get',
  'getOwnPermissions',
  'Identity',
  { kind: 'authenticated' },
  'read',
);
add('/api/v1/auth/login', 'post', 'login', 'Identity', { kind: 'public' });
add('/api/v1/auth/register', 'post', 'registerAccount', 'Identity', { kind: 'public' });
add('/api/v1/auth/options', 'get', 'getAuthOptions', 'Identity', { kind: 'public' }, 'read');
add(
  '/api/v1/auth/tokens',
  'get',
  'listUserTokens',
  'Identity',
  { kind: 'account-session' },
  'read',
);
add('/api/v1/auth/tokens', 'post', 'createUserToken', 'Identity', { kind: 'account-session' });
add(
  '/api/v1/auth/tokens/{id}',
  'delete',
  'revokeUserToken',
  'Identity',
  { kind: 'account-session' },
  'idempotent',
);
add('/api/v1/auth/me', 'get', 'getCurrentPrincipal', 'Identity', { kind: 'authenticated' }, 'read');
add('/api/v1/auth/logout', 'post', 'logout', 'Identity', { kind: 'authenticated' }, 'idempotent');
add('/api/v1/auth/password', 'post', 'changeOwnPassword', 'Identity', { kind: 'account-session' });
for (const [path, method, id] of accountAdministrationOperations)
  add(
    `/api/v1${path}`,
    method,
    id,
    'Identity',
    { kind: 'administrator' },
    method === 'get'
      ? 'read'
      : method === 'put' || method === 'delete'
        ? 'idempotent'
        : 'never-automatic',
  );
for (const [path, method, id, retry] of [
  ['/service-accounts', 'get', 'listServiceAccounts', 'read'],
  ['/service-accounts', 'post', 'createServiceAccount', 'never-automatic'],
  ['/service-accounts/{id}', 'get', 'getServiceAccount', 'read'],
  ['/service-accounts/{id}', 'patch', 'updateServiceAccount', 'compare-and-swap'],
  ['/service-accounts/{id}/policy', 'get', 'getServicePolicy', 'read'],
  ['/service-accounts/{id}/policy', 'put', 'setServicePolicy', 'compare-and-swap'],
  ['/service-accounts/{id}/keys', 'get', 'listServiceKeys', 'read'],
  ['/service-accounts/{id}/keys', 'post', 'issueServiceKey', 'idempotency-key'],
  ['/service-accounts/{id}/audit', 'get', 'getServiceAudit', 'read'],
  ['/api-keys/{id}', 'get', 'getServiceKey', 'read'],
  ['/api-keys/{id}/rotate', 'post', 'rotateServiceKey', 'idempotency-key'],
  ['/api-keys/{id}/revoke', 'post', 'revokeServiceKey', 'idempotent'],
] as const) {
  const actions: Record<string, AdministrationPermission> = {
    listServiceAccounts: 'service-account.read',
    getServiceAccount: 'service-account.read',
    updateServiceAccount: 'service-account.manage',
    getServicePolicy: 'policy.read',
    setServicePolicy: 'policy.manage',
    listServiceKeys: 'credential.read',
    issueServiceKey: 'credential.manage',
    getServiceAudit: 'service-audit.read',
    getServiceKey: 'credential.read',
    rotateServiceKey: 'credential.manage',
    revokeServiceKey: 'credential.manage',
  };
  const action = actions[id];
  add(
    `/api/v1${path}`,
    method,
    id,
    'Services',
    action
      ? {
          kind: 'service-administration',
          action,
          resource:
            id === 'listServiceAccounts'
              ? 'visible-accounts'
              : path.startsWith('/api-keys')
                ? 'key.accountId'
                : 'path.id',
          bootstrapAlternative: true,
        }
      : { kind: 'service-bootstrap' },
    retry,
  );
}
add(
  '/api/v1/api-keys/{id}/delegations',
  'get',
  'listServiceDelegations',
  'Services',
  { kind: 'bootstrap-or-own-key' },
  'read',
);
add(
  '/api/v1/api-keys/{id}/delegations/{accountId}',
  'put',
  'setServiceDelegation',
  'Services',
  { kind: 'service-bootstrap' },
  'compare-and-swap',
);
add(
  '/api/v1/api-keys/{id}/delegations/{accountId}',
  'delete',
  'removeServiceDelegation',
  'Services',
  { kind: 'service-bootstrap' },
  'compare-and-swap',
);
add(
  '/api/v1/auth/activate-key',
  'post',
  'activateServiceKey',
  'Services',
  { kind: 'pending-or-active-key' },
  'idempotent',
);
for (const [path, method, id, tag, actions, legacy, retry, owner] of catalogOperations)
  data(path, method, id, tag, actions, legacy, retry, owner ?? undefined);
for (const [method, id] of [
  ['post', 'addReference'],
  ['delete', 'removeReference'],
] as const)
  data(
    `${root}/artifacts/{id}/references`,
    method,
    id,
    'Catalog',
    ['reference.write', 'artifact.read'],
    ['read', 'write'],
    'idempotent',
    'reference',
  );
for (const [path, id] of [
  [`${root}/packages/content`, 'downloadPackageContent'],
  [`${root}/asset/content`, 'downloadAssetContent'],
] as const)
  data(path, 'get', id, 'Content', ['content.read'], ['read'], 'read');

for (const [suffix, method, id, actions, legacy, retry] of attachmentOperations)
  data(
    root + '/artifacts/{id}/attachments' + suffix,
    method,
    id,
    'Catalog',
    actions,
    legacy,
    retry,
  );
for (const [suffix, method, id, actions, legacy, retry] of [
  ...promotionOperations,
  ...mirrorOperations,
  ...downloadLinkOperationPolicies,
  ...rawOperationPolicies,
])
  data(root + suffix, method, id, 'Catalog', actions, legacy, retry);
for (const [path, method, id, actions, retry] of storageOperations)
  data(root + path, method, id, 'Catalog', actions, null, retry);
for (const [path, method, id, action, retry] of backupOperations)
  add(`/api/v1${path}`, method, id, 'Backups', { kind: 'system', action }, retry);
export const operationPolicies: Readonly<typeof policies> = policies;
