import test from 'node:test';
import assert from 'node:assert/strict';
import { IdentityService, operationVisible } from '@proanima/arkvory-application';

const now = Date.parse('2026-10-01T00:00:00.000Z');
const day = 24 * 60 * 60 * 1000;
const session = { id: 'user:user-bob', credential: 'session', repositories: [], permissions: [] };
const personal = { ...session, credential: 'personal-token', tokenScope: 'read-write' };
const fileAdmin = { id: 'admin', credential: 'file-key', repositories: [], permissions: [] };

function harness(allowRegistration = false) {
  const calls = [];
  const audit = [];
  const record =
    (action) =>
    async (...args) => {
      calls.push({ action, args });
      return action === 'createUser'
        ? { id: 'user-bob', name: args[0], administrator: args[2], enabled: true }
        : action === 'login'
          ? { token: 'dps_session', expiresAt: '2026-10-01T12:00:00.000Z', account: {} }
          : action === 'tokens'
            ? []
            : undefined;
    };
  const store = Object.fromEntries(
    [
      'createUser',
      'updateUser',
      'createGroup',
      'membership',
      'grant',
      'login',
      'changePassword',
      'createToken',
      'tokens',
      'revokeToken',
      'users',
    ].map((name) => [name, record(name)]),
  );
  const service = new IdentityService(store, {
    allowRegistration,
    now: () => new Date(now),
    audit: {
      append: async (actor, event) => {
        audit.push({ actor, event });
      },
      list: async (after, limit) => ({ items: [], next: null, after, limit }),
    },
  });
  return { service, calls, audit };
}

test('account administration requires a non-token administrator and validates input', async () => {
  const { service, calls } = harness();
  const reader = { ...fileAdmin, id: 'reader' };
  const admin = { ...fileAdmin, administrator: true };
  await assert.rejects(service.createUser(reader, 'alice', 'long-password', false, null), {
    code: 'forbidden',
  });
  // A personal token never administers accounts, even if a flag leaked into the principal.
  await assert.rejects(service.users({ ...personal, administrator: true }), { code: 'forbidden' });
  await assert.rejects(service.createUser(admin, 'alice', 'short', false, null), {
    code: 'invalid_input',
  });
  await service.createUser(admin, 'alice', 'long-password', false, '198.51.100.4');
  assert.deepEqual(calls[0].args, [
    'alice',
    'long-password',
    false,
    'administrator',
    { id: 'admin', credential: 'file-key', clientIp: '198.51.100.4' },
  ]);
  await service.grant(admin, 'group-id', 'releases', 'write', null);
  assert.deepEqual(calls[1].args.slice(0, 3), ['group-id', 'releases', 'write']);
  await assert.rejects(service.grant(admin, 'group-id', '../secret', 'read', null), {
    code: 'invalid_input',
  });
  await assert.rejects(service.accountTokens({ ...session, administrator: false }, 'x'), {
    code: 'forbidden',
  });
  await service.accountTokens({ ...session, administrator: true }, 'user-alice');
  assert.deepEqual(calls.at(-1), { action: 'tokens', args: ['user-alice'] });
  await service.revokeAccountToken(admin, 'user-alice', 'token-1', null);
  assert.deepEqual(calls.at(-1).args.slice(0, 2), ['user-alice', 'token-1']);
});

test('credential management needs an interactive session and denials are journaled', async () => {
  const { service, calls, audit } = harness();
  for (const principal of [personal, fileAdmin, { ...fileAdmin, credential: 'service-key' }]) {
    await assert.rejects(service.createToken(principal, { name: 'child' }, '192.0.2.1'), {
      code: 'forbidden',
    });
    await assert.rejects(service.tokens(principal, null), { code: 'forbidden' });
    await assert.rejects(service.revokeToken(principal, 'token-1', null), { code: 'forbidden' });
    await assert.rejects(service.changePassword(principal, 'long-password', 'new-long-pw'), {
      code: 'forbidden',
    });
  }
  assert.equal(calls.length, 0);
  assert.equal(audit.length, 12);
  assert.deepEqual(audit[0], {
    actor: { id: 'user:user-bob', credential: 'personal-token', clientIp: '192.0.2.1' },
    event: {
      action: 'token.create',
      target: 'user:user-bob',
      outcome: 'denied',
      code: 'session_required',
    },
  });
  await service.changePassword(session, 'long-password', 'new-long-password', null);
  assert.deepEqual(calls.at(-1).args.slice(0, 3), [
    'user-bob',
    'long-password',
    'new-long-password',
  ]);
});

test('personal tokens get a mandatory bounded expiry and an explicit scope', async () => {
  const { service, calls } = harness();
  await service.createToken(session, { name: ' CI ' }, null);
  assert.deepEqual(calls.at(-1).args.slice(0, 3), [
    'user-bob',
    'CI',
    { expiresAt: new Date(now + 90 * day), scope: 'read-write' },
  ]);
  const year = new Date(now + 365 * day).toISOString();
  await service.createToken(session, { name: 'ro', expiresAt: year, scope: 'read' }, null);
  assert.deepEqual(calls.at(-1).args[2], { expiresAt: new Date(year), scope: 'read' });
  // Browser clocks drift: up to an hour beyond the maximum is clamped, not rejected.
  const skewed = new Date(now + 365 * day + 30 * 60 * 1000).toISOString();
  await service.createToken(session, { name: 'skew', expiresAt: skewed }, null);
  assert.deepEqual(calls.at(-1).args[2].expiresAt, new Date(now + 365 * day));
  for (const expiresAt of [
    new Date(now - 1000).toISOString(),
    new Date(now).toISOString(),
    new Date(now + 366 * day).toISOString(),
    '2026-13-01T00:00:00Z',
    'tomorrow',
    '1767225600000',
    1767225600000,
  ])
    await assert.rejects(service.createToken(session, { name: 'bad', expiresAt }, null), {
      code: 'invalid_input',
    });
  await assert.rejects(service.createToken(session, { name: 'x', scope: 'admin' }, null), {
    code: 'invalid_input',
  });
});

test('registration flag gates self-registration with a reduced account capacity', async () => {
  const disabled = harness(false);
  await assert.rejects(disabled.service.register('bobuser', 'long-password-123', null), {
    code: 'forbidden',
  });
  assert.equal(disabled.calls.length, 0);
  const enabled = harness(true);
  const login = await enabled.service.register('bobuser', 'long-password-123', '192.0.2.9');
  assert.equal(login.token, 'dps_session');
  assert.deepEqual(enabled.calls[0].args.slice(2, 4), [false, 'self-registration']);
  assert.deepEqual(enabled.calls[1].args[2], { id: null, credential: null, clientIp: '192.0.2.9' });
});

test('security journal is administrator-only and validates its page cursor', async () => {
  const { service } = harness();
  const admin = { ...session, administrator: true };
  assert.deepEqual(await service.securityAudit(admin, '17', '20'), {
    items: [],
    next: null,
    after: '17',
    limit: 20,
  });
  assert.equal((await service.securityAudit(admin, undefined, undefined)).limit, 50);
  await assert.rejects(service.securityAudit(personal, undefined, undefined), {
    code: 'forbidden',
  });
  for (const [after, limit] of [
    ['0', undefined],
    ['-1', undefined],
    ['1e3', undefined],
    [['1', '2'], undefined],
    [undefined, '0'],
    [undefined, '101'],
    [undefined, '5.5'],
  ])
    await assert.rejects(service.securityAudit(admin, after, limit), { code: 'invalid_input' });
});

test('operation discovery hides session-only and administrator operations from tokens', () => {
  const sessionOnly = { kind: 'account-session' };
  const admin = { kind: 'administrator' };
  assert.equal(operationVisible(session, sessionOnly, undefined, []), true);
  assert.equal(operationVisible(personal, sessionOnly, undefined, []), false);
  assert.equal(operationVisible({ ...personal, administrator: true }, admin, undefined, []), false);
  assert.equal(operationVisible({ ...session, administrator: true }, admin, undefined, []), true);
});
