import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authorize,
  authorizeAction,
  parseBindings,
  intersectBindings,
  requireSubset,
  serviceActions,
} from '@proanima/depot-domain';
import { servicePermissionNames, readApiKey } from '@proanima/depot-contracts';
import { parseKeys } from '@proanima/depot-infrastructure';
import { ServiceAccess } from '@proanima/depot-application';

const binding = (id, actions) => ({ resource: { kind: 'repository', id }, actions });
test('managed action and resource bindings never form a cross product or fall back to coarse grants', () => {
  const account = parseBindings([
    binding('alpha', ['content.read']),
    binding('beta', ['upload.create']),
  ]);
  const key = parseBindings([
    binding('beta', ['content.read']),
    binding('alpha', ['upload.create']),
  ]);
  assert.deepEqual(intersectBindings(account, key), []);
  const principal = {
    id: 'service:one',
    repositories: ['alpha'],
    permissions: ['read', 'write'],
    administrator: true,
    managed: { accountId: 'one', keyId: 'key', bindings: account },
  };
  authorizeAction(principal, 'alpha', 'content.read', ['read']);
  assert.throws(() => authorizeAction(principal, 'alpha', 'artifact.read', ['read']), {
    code: 'forbidden',
  });
  assert.throws(() => authorize(principal, 'alpha', 'read'), { code: 'forbidden' });
  assert.throws(() => requireSubset(key, account), { code: 'forbidden' });
  assert.throws(() => parseBindings([binding('*', ['content.read'])]), { code: 'invalid_input' });
  assert.throws(() => parseBindings([binding('alpha', ['credential.manage'])]), {
    code: 'invalid_input',
  });
  assert.throws(
    () =>
      parseBindings([
        { resource: { kind: 'repository', id: 'alpha', prefix: 'x' }, actions: ['content.read'] },
      ]),
    { code: 'invalid_input' },
  );
  assert.deepEqual(serviceActions, servicePermissionNames);
});
test('existing administrator has no implicit service bootstrap privilege', () => {
  const [key] = parseKeys([
    { id: 'admin', sha256: 'a'.repeat(64), repositories: [], permissions: [], administrator: true },
  ]);
  assert.equal(key.principal.serviceAdministrator, false);
  const service = new ServiceAccess({
    create() {
      throw new Error('Must never reach store');
    },
  });
  assert.throws(() => service.create(key.principal, { name: 'abc', bindings: [] }), {
    code: 'forbidden',
  });
  assert.throws(() => readApiKey({}), /Invalid/);
});
