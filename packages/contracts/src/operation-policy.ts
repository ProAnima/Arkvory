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
        kind: 'service-administration';
        action: AdministrationPermission;
        resource: 'visible-accounts' | 'path.id' | 'key.accountId';
        bootstrapAlternative: true;
      }
    | {
        kind: 'repository';
        resource: 'path.repository' | 'job.repository';
        actions: readonly ServicePermission[];
        legacy: readonly ('read' | 'write')[];
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
  legacy: readonly ('read' | 'write')[],
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
  legacy: readonly ('read' | 'write')[],
  retry: OperationPolicy['retry'],
  owner?: 'upload' | 'job' | 'reference',
) {
  add(path, method, id, tag, repo(actions, legacy, owner), retry);
}
add('/health/live', 'get', 'getLiveness', 'System', { kind: 'public' }, 'read');
add('/health/ready', 'get', 'getReadiness', 'System', { kind: 'authenticated' }, 'read');
add('/api/v1/openapi.json', 'get', 'getOpenApi', 'System', { kind: 'authenticated' }, 'read');
add('/api/v1/capabilities', 'get', 'getCapabilities', 'System', { kind: 'authenticated' }, 'read');
add(
  '/api/v1/auth/permissions',
  'get',
  'getOwnPermissions',
  'Identity',
  { kind: 'authenticated' },
  'read',
);
add('/api/v1/auth/login', 'post', 'login', 'Identity', { kind: 'public' });
add('/api/v1/auth/me', 'get', 'getCurrentPrincipal', 'Identity', { kind: 'authenticated' }, 'read');
add('/api/v1/auth/logout', 'post', 'logout', 'Identity', { kind: 'authenticated' }, 'idempotent');
add('/api/v1/auth/password', 'post', 'changeOwnPassword', 'Identity', { kind: 'account-session' });
for (const [path, method, id] of [
  ['/users', 'get', 'listUsers'],
  ['/users', 'post', 'createUser'],
  ['/users/{id}', 'patch', 'updateUser'],
  ['/access-groups', 'get', 'listAccessGroups'],
  ['/access-groups', 'post', 'createAccessGroup'],
  ['/access-groups/{id}/members/{userId}', 'put', 'addGroupMember'],
  ['/access-groups/{id}/members/{userId}', 'delete', 'removeGroupMember'],
  ['/access-groups/{id}/grants/{repository}', 'put', 'setGroupGrant'],
  ['/access-groups/{id}/grants/{repository}', 'delete', 'removeGroupGrant'],
] as const)
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
data(
  `${root}/uploads`,
  'post',
  'createUpload',
  'Uploads',
  ['upload.create'],
  ['write'],
  'idempotency-key',
);
data(
  `${root}/uploads/{id}`,
  'get',
  'getUpload',
  'Uploads',
  ['upload.read'],
  ['write'],
  'read',
  'upload',
);
data(
  `${root}/uploads/{id}`,
  'delete',
  'cancelUpload',
  'Uploads',
  ['upload.cancel'],
  ['write'],
  'reconcile-upload',
  'upload',
);
data(
  `${root}/uploads/{id}/content`,
  'put',
  'putUploadContent',
  'Uploads',
  ['upload.write', 'upload.complete'],
  ['write'],
  'reconcile-upload',
  'upload',
);
data(
  `${root}/uploads/{id}/parts`,
  'get',
  'listUploadParts',
  'Uploads',
  ['upload.read'],
  ['write'],
  'read',
  'upload',
);
data(
  `${root}/uploads/{id}/parts/{index}`,
  'put',
  'putUploadPart',
  'Uploads',
  ['upload.write'],
  ['write'],
  'reconcile-upload',
  'upload',
);
data(
  `${root}/uploads/{id}/complete`,
  'post',
  'completeUpload',
  'Uploads',
  ['upload.complete'],
  ['write'],
  'reconcile-upload',
  'upload',
);
data(
  `${root}/uploads/{id}/complete-async`,
  'post',
  'enqueueCompletion',
  'Uploads',
  ['upload.complete'],
  ['write'],
  'reconcile-job',
  'upload',
);
data(
  '/api/v1/jobs/{id}',
  'get',
  'getCompletionJob',
  'Uploads',
  ['job.read'],
  ['write'],
  'read',
  'job',
);
data(`${root}/artifacts`, 'get', 'listArtifacts', 'Catalog', ['artifact.list'], ['read'], 'read');
data(
  `${root}/artifacts/{id}`,
  'get',
  'getArtifact',
  'Catalog',
  ['artifact.read'],
  ['read'],
  'read',
);
data(
  `${root}/artifacts/{id}/content`,
  'get',
  'downloadArtifact',
  'Content',
  ['content.read'],
  ['read'],
  'read',
);
data(
  `${root}/artifacts/{id}/content`,
  'head',
  'headArtifactContent',
  'Content',
  ['content.read'],
  ['read'],
  'read',
);
data(
  `${root}/artifacts/{id}/annotations`,
  'get',
  'getAnnotations',
  'Catalog',
  ['annotation.read'],
  ['read'],
  'read',
);
data(
  `${root}/artifacts/{id}/annotations`,
  'put',
  'setAnnotations',
  'Catalog',
  ['annotation.write', 'artifact.read'],
  ['read', 'write'],
  'compare-and-swap',
);
data(
  `${root}/artifacts/{id}/package`,
  'post',
  'registerPackage',
  'Catalog',
  ['package.publish', 'artifact.read'],
  ['read', 'write'],
  'idempotent',
);
data(`${root}/packages`, 'get', 'listPackages', 'Catalog', ['package.read'], ['read'], 'read');
data(`${root}/assets`, 'get', 'listAssets', 'Catalog', ['asset.read'], ['read'], 'read');
data(`${root}/assets/page`, 'get', 'listAssetPage', 'Catalog', ['asset.read'], ['read'], 'read');
data(`${root}/asset`, 'get', 'getAsset', 'Catalog', ['asset.read'], ['read'], 'read');
data(
  `${root}/asset`,
  'put',
  'setAsset',
  'Catalog',
  ['asset.write', 'artifact.read'],
  ['read', 'write'],
  'compare-and-swap',
);
data(
  `${root}/asset/history`,
  'get',
  'getAssetHistory',
  'Catalog',
  ['asset.read'],
  ['read'],
  'read',
);
data(
  `${root}/asset/revision`,
  'get',
  'getAssetRevision',
  'Catalog',
  ['asset.read'],
  ['read'],
  'read',
);
data(
  `${root}/asset/restore`,
  'post',
  'restoreAsset',
  'Catalog',
  ['asset.restore', 'asset.read', 'artifact.read'],
  ['read', 'write'],
  'compare-and-swap',
);
data(`${root}/search`, 'get', 'searchArtifacts', 'Catalog', ['artifact.list'], ['read'], 'read');
data(`${root}/audit`, 'get', 'getCatalogAudit', 'Catalog', ['audit.read'], ['write'], 'read');
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
  ['/api/packages/{repository}/download', 'downloadCommonPackage'],
  ['/upack/{repository}/download/{packagePath}', 'downloadUniversalPackage'],
  ['/endpoints/{repository}/content/{assetPath}', 'downloadLegacyAsset'],
] as const)
  data(path, 'get', id, 'Legacy', ['content.read'], ['read'], 'read');
export const operationPolicies: Readonly<typeof policies> = policies;
