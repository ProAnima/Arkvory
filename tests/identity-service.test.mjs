import test from 'node:test';
import assert from 'node:assert/strict';
import { IdentityService } from '@proanima/arkvory-application';

test('only administrators can register accounts and repository grants are validated', async () => {
  const calls = [];
  const store = {
    createUser: async (name, password, administrator) => {
      calls.push({ action: 'user', name, password, administrator });
      return { id: 'u', name, administrator, enabled: true };
    },
    grant: async (groupId, repository, access) => {
      calls.push({ action: 'grant', groupId, repository, access });
    },
    changePassword: async (id, currentPassword, newPassword) => {
      calls.push({ action: 'password', id, currentPassword, newPassword });
    },
  };
  const service = new IdentityService(store);
  const reader = { id: 'reader', repositories: [], permissions: [] };
  const admin = { ...reader, id: 'admin', administrator: true };
  assert.throws(() => service.createUser(reader, 'alice', 'long-password', false), {
    code: 'forbidden',
  });
  assert.throws(() => service.createUser(admin, 'alice', 'short', false), {
    code: 'invalid_input',
  });
  await service.createUser(admin, 'alice', 'long-password', false);
  assert.deepEqual(calls[0], {
    action: 'user',
    name: 'alice',
    password: 'long-password',
    administrator: false,
  });
  await service.grant(admin, 'group-id', 'releases', 'write');
  assert.deepEqual(calls[1], {
    action: 'grant',
    groupId: 'group-id',
    repository: 'releases',
    access: 'write',
  });
  assert.throws(() => service.grant(admin, 'group-id', '../secret', 'read'), {
    code: 'invalid_input',
  });
  assert.throws(() => service.changePassword(admin, 'long-password', 'new-long-password'), {
    code: 'forbidden',
  });
  await service.changePassword(
    { ...reader, id: 'user:account-id' },
    'long-password',
    'new-long-password',
  );
  assert.deepEqual(calls.at(-1), {
    action: 'password',
    id: 'account-id',
    currentPassword: 'long-password',
    newPassword: 'new-long-password',
  });
});

test('registration flag controls self-registration and personal access tokens require account session', async () => {
  const calls = [];
  const store = {
    createUser: async (name, password, administrator) => {
      calls.push({ action: 'create', name, password, administrator });
      return { id: 'user-bob', name, administrator, enabled: true };
    },
    login: async (name, password) => {
      calls.push({ action: 'login', name, password });
      return {
        token: 'dps_session',
        expiresAt: '2026-09-30T12:00:00.000Z',
        account: { id: 'user-bob', name, administrator: false, enabled: true },
      };
    },
    createToken: async (userId, name, expiresAt) => {
      calls.push({ action: 'createToken', userId, name, expiresAt });
      return {
        id: 'token-1',
        userId,
        name,
        prefix: 'pat_test...',
        token: 'pat_full_secret',
        createdAt: '2026-09-30T12:00:00.000Z',
        expiresAt: expiresAt ?? null,
        lastUsedAt: null,
        revoked: false,
      };
    },
    tokens: async (userId) => {
      calls.push({ action: 'tokens', userId });
      return [];
    },
    revokeToken: async (userId, tokenId) => {
      calls.push({ action: 'revokeToken', userId, tokenId });
    },
  };
  const disabledService = new IdentityService(store, false);
  await assert.rejects(() => disabledService.register('bobuser', 'long-password-123'), {
    code: 'forbidden',
  });

  const enabledService = new IdentityService(store, true);
  const session = await enabledService.register('bobuser', 'long-password-123');
  assert.equal(session.account.name, 'bobuser');
  assert.equal(session.token, 'dps_session');

  const userPrincipal = { id: 'user:user-bob', repositories: [], permissions: [] };
  const keyPrincipal = { id: 'service-key-1', repositories: [], permissions: [] };

  assert.throws(() => enabledService.createToken(keyPrincipal, 'My Token'), {
    code: 'forbidden',
  });
  assert.throws(() => enabledService.tokens(keyPrincipal), {
    code: 'forbidden',
  });
  assert.throws(() => enabledService.revokeToken(keyPrincipal, 'token-1'), {
    code: 'forbidden',
  });

  const created = await enabledService.createToken(userPrincipal, 'My Token');
  assert.equal(created.name, 'My Token');
  assert.equal(created.token, 'pat_full_secret');
  assert.deepEqual(calls.at(-1), {
    action: 'createToken',
    userId: 'user-bob',
    name: 'My Token',
    expiresAt: undefined,
  });

  await enabledService.tokens(userPrincipal);
  assert.deepEqual(calls.at(-1), { action: 'tokens', userId: 'user-bob' });

  await enabledService.revokeToken(userPrincipal, 'token-1');
  assert.deepEqual(calls.at(-1), { action: 'revokeToken', userId: 'user-bob', tokenId: 'token-1' });
});
