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
