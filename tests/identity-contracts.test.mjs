import test from 'node:test';
import assert from 'node:assert/strict';
import { readAccount, readLogin, readPackageList } from '@proanima/depot-contracts';

test('account and package responses reject malformed identities and group references', () => {
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
