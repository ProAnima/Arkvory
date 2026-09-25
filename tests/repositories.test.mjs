import test from 'node:test';
import assert from 'node:assert/strict';
import {
  effectivePermissions,
  listRepositories,
  repositoryCard,
} from '@proanima/depot-application';
import { authorize, serviceActions } from '@proanima/depot-domain';
import { readRepositoryCard, readRepositoryPage, openApiDocument } from '@proanima/depot-contracts';
const base = { id: 'test', repositories: ['ignored'], permissions: ['read', 'write'] };
const binding = (id, actions) => ({ resource: { kind: 'repository', id }, actions });

test('repository discovery preserves coarse permission mapping and explicit group overrides', () => {
  const principal = {
    ...base,
    grants: [
      { repository: 'alpha', permissions: ['read'] },
      { repository: 'alpha', permissions: ['write'] },
      { repository: 'beta', permissions: ['write'] },
      { repository: 'empty', permissions: [] },
    ],
  };
  const bindings = effectivePermissions(principal);
  assert.deepEqual(
    bindings.find((b) => b.resource.id === 'alpha').actions,
    serviceActions.filter(
      (a) =>
        a !== 'repository.read' &&
        a !== 'artifact.delete' &&
        a !== 'storage.read' &&
        a !== 'storage.manage' &&
        a !== 'diagnostics.read',
    ),
  );
  assert.deepEqual(bindings.find((b) => b.resource.id === 'beta').actions, [
    'upload.create',
    'upload.read',
    'upload.write',
    'upload.complete',
    'upload.cancel',
    'job.read',
    'audit.read',
  ]);
  assert.deepEqual(
    bindings.map((b) => b.resource.id),
    ['alpha', 'beta'],
  );
  assert.deepEqual(
    listRepositories(principal).items.map((c) => c.id),
    ['alpha', 'beta'],
  );
  assert.throws(() => authorize(principal, 'ignored', 'read'), { code: 'forbidden' });
  assert.throws(() => repositoryCard(principal, 'ignored'), { code: 'not_found' });
  assert.deepEqual(
    listRepositories({ ...base, grants: [], administrator: true, serviceAdministrator: true })
      .items,
    [],
  );
  assert.equal(
    bindings.some((b) => b.actions.includes('repository.read')),
    false,
  );
});

test('managed repository discovery requires explicit permission and merges only the same repository', () => {
  const principal = {
    ...base,
    administrator: true,
    managed: {
      accountId: 'account',
      keyId: 'key',
      bindings: [
        binding('hidden', ['content.read']),
        binding('visible', ['repository.read']),
        binding('visible', ['asset.read']),
        binding('other', ['repository.read']),
      ],
    },
  };
  const before = structuredClone(principal);
  const first = listRepositories(principal, 1);
  assert.equal(first.items[0].id, 'other');
  assert.equal(first.next, 'other');
  const last = listRepositories(principal, 100, first.next);
  assert.deepEqual(
    last.items.map((c) => c.id),
    ['visible'],
  );
  assert.equal(last.next, null);
  assert.deepEqual(last.items[0].permissions, ['asset.read', 'repository.read']);
  assert.throws(() => repositoryCard(principal, 'hidden'), { code: 'not_found' });
  assert.deepEqual(principal, before);
  for (const limit of [0, 101, NaN, 1.1])
    assert.throws(() => listRepositories(principal, limit), { code: 'invalid_input' });
  assert.throws(() => listRepositories(principal, 50, 'Bad/ID'), { code: 'invalid_input' });
});

test('repository pages support bounded large identity grants without materializing global storage inventory', () => {
  const grants = Array.from({ length: 10000 }, (_, i) => ({
    repository: `repo-${String(i).padStart(5, '0')}`,
    permissions: i % 3 === 0 ? [] : ['write'],
  }));
  const principal = { ...base, grants };
  const first = listRepositories(principal, 100);
  assert.equal(first.items.length, 100);
  assert.equal(first.items[0].id, 'repo-00001');
  const nearEnd = listRepositories(principal, 100, 'repo-09950');
  assert.deepEqual(
    nearEnd.items.map((c) => c.id),
    grants
      .filter((g) => g.repository > 'repo-09950' && g.permissions.length)
      .map((g) => g.repository),
  );
  assert.equal(nearEnd.next, null);
});

test('repository wire parsers and access metadata reject malformed or ambiguous discovery results', () => {
  const card = { id: 'alpha', formats: ['upack', 'assets'], permissions: ['repository.read'] };
  assert.deepEqual(readRepositoryCard(card), card);
  assert.deepEqual(readRepositoryPage({ items: [card], next: 'alpha' }, 1), {
    items: [card],
    next: 'alpha',
  });
  for (const value of [
    { ...card, id: 'Bad' },
    { ...card, formats: ['upack'] },
    { ...card, permissions: ['content.read'] },
    { ...card, permissions: ['repository.read', 'repository.read'] },
    { ...card, permissions: ['repository.read', 'unknown'] },
  ])
    assert.throws(() => readRepositoryCard(value));
  for (const value of [
    { items: [card, card], next: null },
    { items: [card], next: 'beta' },
    { items: [], next: 'alpha' },
    { items: Array(101).fill(card), next: null },
  ])
    assert.throws(() => readRepositoryPage(value, 1));
  for (const path of ['/api/v1/repositories', '/api/v1/repositories/{repository}']) {
    const access = openApiDocument.paths[path].get['x-depot-authorization'];
    assert.equal(access.action, 'repository.read');
    assert.equal(access.legacy, 'own-nonempty-grants');
  }
});
