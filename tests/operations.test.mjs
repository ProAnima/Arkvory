import test from 'node:test';
import assert from 'node:assert/strict';
import {
  apiOperations,
  apiSurfaces,
  apiVisibilities,
  openApiSurface,
  openApiDocument,
  readOperationPage,
} from '@proanima/arkvory-contracts';
import { operationVisible } from '@proanima/arkvory-application';
const binding = (id, actions) => ({ resource: { kind: 'repository', id }, actions });
const managed = {
  id: 'service:a',
  repositories: [],
  permissions: [],
  managed: {
    keyId: 'key-a',
    bindings: [binding('alpha', ['upload.write']), binding('beta', ['upload.complete'])],
  },
};
test('all operations have one explicit responsibility and visibility; documentation surfaces partition inventory', () => {
  const found = [];
  for (const surface of apiSurfaces) {
    const document = openApiSurface(surface);
    assert.equal(document['x-arkvory-document-surface'], surface);
    for (const item of Object.values(document.paths))
      for (const method of ['get', 'head', 'post', 'put', 'patch', 'delete'])
        if (item[method]) {
          const operation = item[method];
          assert.equal(operation['x-arkvory-surface'], surface);
          assert.ok(apiVisibilities.includes(operation['x-arkvory-visibility']));
          found.push(operation.operationId);
        }
  }
  assert.deepEqual(found.sort(), apiOperations.map((o) => o.operationId).sort());
  assert.equal(new Set(found).size, found.length);
  assert.equal(openApiDocument.info.version, '0.13.0');
});
test('operation visibility keeps resource bindings, bootstrap, user admin and delegated actions independent', () => {
  const content = apiOperations.find((o) => o.operationId === 'putUploadContent').access;
  assert.equal(operationVisible(managed, content, 'alpha', []), false);
  assert.equal(operationVisible(managed, content, 'beta', []), false);
  const both = {
    ...managed,
    managed: {
      ...managed.managed,
      bindings: [binding('alpha', ['upload.write', 'upload.complete'])],
    },
  };
  assert.equal(operationVisible(both, content, 'alpha', []), true);
  assert.equal(operationVisible(both, content, undefined, []), false);
  assert.equal(
    operationVisible(
      both,
      { kind: 'repository-discovery', resource: 'path.repository' },
      'alpha',
      [],
    ),
    false,
  );
  const grant = {
    keyId: 'key-a',
    targetAccountId: 'target',
    enabled: true,
    actions: ['credential.manage'],
    ceiling: [],
  };
  assert.equal(
    operationVisible(
      managed,
      { kind: 'service-administration', action: 'credential.manage' },
      undefined,
      [grant],
    ),
    true,
  );
  for (const g of [
    { ...grant, enabled: false },
    { ...grant, keyId: 'other' },
  ])
    assert.equal(
      operationVisible(
        managed,
        { kind: 'service-administration', action: 'credential.manage' },
        undefined,
        [g],
      ),
      false,
    );
  assert.equal(
    operationVisible(
      managed,
      { kind: 'service-administration', action: 'policy.manage' },
      undefined,
      [grant],
    ),
    false,
  );
  assert.equal(operationVisible(managed, { kind: 'service-bootstrap' }, undefined, [grant]), false);
  const admin = { id: 'user:admin', repositories: [], permissions: [], administrator: true };
  assert.equal(operationVisible(admin, { kind: 'administrator' }, undefined, []), true);
  assert.equal(operationVisible(admin, { kind: 'service-bootstrap' }, undefined, []), false);
  assert.equal(operationVisible(admin, content, 'alpha', []), false);
  const root = { ...admin, administrator: false, serviceAdministrator: true };
  assert.equal(operationVisible(root, { kind: 'administrator' }, undefined, []), false);
  assert.equal(operationVisible(root, { kind: 'service-bootstrap' }, undefined, []), true);
});
test('discovery of exact repository operations is not truncated by directory page size', () => {
  const principal = {
    id: 'many',
    repositories: Array.from({ length: 150 }, (_, i) => `repo-${String(i).padStart(3, '0')}`),
    permissions: ['read'],
  };
  assert.equal(
    operationVisible(
      principal,
      { kind: 'repository-discovery', resource: 'path.repository' },
      'repo-149',
      [],
    ),
    true,
  );
  assert.equal(
    operationVisible(
      principal,
      { kind: 'repository-discovery', resource: 'path.repository' },
      'absent',
      [],
    ),
    false,
  );
});
test('operation wire parser rejects oversized, unordered, unrecognized and inconsistent responses', () => {
  const operation = {
    operationId: 'downloadArtifact',
    method: 'get',
    path: '/api/v1/repositories/{repository}/artifacts/{id}/content',
    summary: 'Download',
    surface: 'transfers',
    visibility: 'repository',
    retry: 'read',
    requiredActions: ['content.read'],
    conditions: ['resource-state'],
  };
  const page = {
    apiVersion: 'v1',
    documentVersion: '0.7.0',
    gatewayRole: 'api',
    repository: 'alpha',
    advisory: true,
    items: [operation],
    next: null,
  };
  assert.deepEqual(readOperationPage(page), page);
  for (const invalid of [
    { ...page, advisory: false },
    { ...page, items: Array(101).fill(operation) },
    { ...page, items: [operation, operation] },
    { ...page, next: 'missing' },
    { ...page, repository: '*' },
    { ...page, items: [{ ...operation, requiredActions: ['admin.*'] }] },
    { ...page, items: [{ ...operation, surface: 'unknown' }] },
    { ...page, items: [{ ...operation, conditions: ['guaranteed'] }] },
  ])
    assert.throws(() => readOperationPage(invalid));
});
