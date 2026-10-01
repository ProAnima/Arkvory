import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readAccount,
  readLogin,
  readPackageList,
  readPrincipal,
  readUserToken,
  readCreatedUserToken,
  readSecurityAuditPage,
  readAuthOptions,
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
  // Servers before scoped tokens only issued full account tokens.
  assert.deepEqual(readUserToken(base), { ...base, scope: 'read-write' });
  const scoped = { ...base, scope: 'read', expiresAt: '2026-12-29T12:00:00.000Z' };
  assert.deepEqual(readUserToken(scoped), scoped);
  const created = { ...scoped, token: 'pat_full_secret_token_value' };
  assert.deepEqual(readCreatedUserToken(created), created);
  assert.throws(() => readUserToken({ ...base, name: 123 }));
  assert.throws(() => readUserToken({ ...base, scope: 'admin' }), /scope/);
  assert.throws(() => readCreatedUserToken(base));
});

test('principal, sign-in options and security audit readers fail closed on unknown values', () => {
  const me = { id: 'user:a', administrator: false, grants: [] };
  assert.deepEqual(readPrincipal(me), { ...me, credential: null, tokenScope: null });
  assert.deepEqual(readPrincipal({ ...me, credential: 'personal-token', tokenScope: 'read' }), {
    ...me,
    credential: 'personal-token',
    tokenScope: 'read',
  });
  assert.throws(() => readPrincipal({ ...me, credential: 'root' }), /credential/);
  assert.deepEqual(readAuthOptions({ selfRegistration: false }), { selfRegistration: false });
  assert.throws(() => readAuthOptions({ selfRegistration: 'yes' }));
  const entry = {
    id: '42',
    occurredAt: '2026-10-01T10:00:00.000Z',
    actor: null,
    credential: null,
    clientIp: '203.0.113.7',
    action: 'auth.login',
    target: 'alice',
    outcome: 'failure',
    code: 'unknown_account',
    details: {},
  };
  assert.deepEqual(readSecurityAuditPage({ items: [entry], next: '42' }), {
    items: [entry],
    next: '42',
  });
  assert.throws(() => readSecurityAuditPage({ items: [{ ...entry, outcome: 'maybe' }] }));
  assert.throws(() => readSecurityAuditPage({ items: [{ ...entry, credential: 'cookie' }] }));
  assert.throws(() => readSecurityAuditPage({ items: [{ ...entry, details: { nested: {} } }] }));
});
