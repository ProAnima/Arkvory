import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readAccount,
  readLogin,
  readPackageList,
  readPrincipal,
  readUserToken,
  readCreatedUserToken,
} from '@proanima/arkvory-contracts';

test('account and package responses reject malformed identities and group references', () => {
  assert.deepEqual(
    readPrincipal({
      id: 'user:alice',
      administrator: false,
      grants: [{ repository: 'releases', permissions: ['read', 'write'] }],
    }).grants,
    [{ repository: 'releases', permissions: ['read', 'write'] }],
  );
  for (const grants of [
    [{ repository: 'releases', permissions: ['admin'] }],
    [{ repository: 'releases', permissions: [] }],
    [
      { repository: 'releases', permissions: ['read'] },
      { repository: 'releases', permissions: ['write'] },
    ],
  ])
    assert.throws(() => readPrincipal({ id: 'user:alice', administrator: false, grants }));
  assert.deepEqual(readAccount({ id: 'u', name: 'alice', administrator: false, enabled: true }), {
    id: 'u',
    name: 'alice',
    administrator: false,
    enabled: true,
  });
  assert.throws(() =>
    readAccount({ id: 'u', name: 'alice', administrator: 'false', enabled: true }),
  );
  assert.equal(
    readLogin({
      token: 'session',
      expiresAt: '2026-09-23T12:00:00.000Z',
      account: { id: 'u', name: 'alice', administrator: false, enabled: true },
    }).account.name,
    'alice',
  );
  const item = { group: 'Tools', name: 'Example', version: '1.0.0', artifactId: 'a', manifest: {} };
  const page = readPackageList({
    items: [item],
    next: null,
    groups: [{ group: 'Tools', name: null, artifactIds: ['a'] }],
  });
  assert.strictEqual(page.groups[0].items[0], page.items[0]);
  assert.throws(() =>
    readPackageList({
      items: [item],
      next: null,
      groups: [{ group: 'Tools', name: null, artifactIds: ['b'] }],
    }),
  );
});

test('user token response parsers validate prefix, dates and secret exposure', () => {
  const base = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    name: 'CLI Token',
    prefix: 'pat_abc123...',
    createdAt: '2026-09-30T12:00:00.000Z',
    expiresAt: null,
    lastUsedAt: null,
    revoked: false,
  };
  assert.deepEqual(readUserToken(base), base);
  const created = { ...base, token: 'pat_full_secret_token_value' };
  assert.deepEqual(readCreatedUserToken(created), created);
  assert.throws(() => readUserToken({ ...base, name: 123 }));
  assert.throws(() => readCreatedUserToken(base));
});
