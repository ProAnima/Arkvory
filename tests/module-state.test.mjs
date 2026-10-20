import test from 'node:test';
import assert from 'node:assert/strict';
import { PostgresModuleState, ModuleHostServices } from '@proanima/arkvory-infrastructure';
import { hostServiceAvailable } from '@proanima/arkvory-extension-api';

test('module state bounds pending operations and releases capacity after database failure', async () => {
  let reject;
  const held = new Promise((_, fail) => {
    reject = fail;
  });
  const state = new PostgresModuleState({ query: () => held }, 'test-state', false);
  const pending = Array.from({ length: 8 }, () => state.read());
  const outcomes = Promise.allSettled(pending);
  await assert.rejects(state.read(), { code: 'busy' });
  reject(new Error('database diagnostic containing opaque bytes'));
  for (const outcome of await outcomes) {
    assert.equal(outcome.status, 'rejected');
    assert.equal(outcome.reason.code, 'unavailable');
    assert.doesNotMatch(outcome.reason.message, /opaque bytes/);
  }
  await assert.rejects(state.read(), { code: 'unavailable' });
});

test('module state service is signed-only and never mutates from reader or backup roles', async (t) => {
  for (const role of ['api', 'worker', 'reader', 'backup']) {
    assert.equal(hostServiceAvailable('module-state', role, 'signed'), true);
    for (const source of ['builtin', 'operator', 'development'])
      assert.equal(hostServiceAvailable('module-state', role, source), false);
    const host = new ModuleHostServices({
      dataDirectory: '.',
      reserve: { bytes: 0, inodes: 0 },
      readOnly: false,
      role,
      dataPool: { query: async () => ({ rows: [] }) },
      catalog: () => assert.fail('not a catalog operation'),
    });
    t.after(() => host.close());
    const planned = {
      manifest: { id: 'test-state', uses: ['module-state'], roles: [role] },
      source: 'signed',
    };
    const service = host.for(planned, null)['module-state'];
    assert.ok(service);
    assert.equal(await service.read(), null);
    if (role === 'reader' || role === 'backup')
      await assert.rejects(service.compareExchange(null, new Uint8Array()), { code: 'read_only' });
    else
      assert.deepEqual(await service.compareExchange(null, new Uint8Array()), { kind: 'conflict' });
  }
});
