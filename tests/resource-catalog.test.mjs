import test from 'node:test';
import assert from 'node:assert/strict';
import { hostServiceAvailable } from '@proanima/arkvory-extension-api';
import { PostgresResourceCatalog } from '@proanima/arkvory-infrastructure';

test('resource catalog is restricted to signed server modules', () => {
  for (const role of ['api', 'worker', 'reader', 'backup']) {
    assert.equal(hostServiceAvailable('resource-catalog', role, 'signed'), true);
    for (const source of ['builtin', 'operator', 'development'])
      assert.equal(hostServiceAvailable('resource-catalog', role, source), false);
  }
});

test('resource module port cannot expose the database or rebind a read-only instance', async () => {
  const pool = { connect: () => assert.fail('read-only port cannot acquire a write connection') };
  const cleanup = {
    run: () => assert.fail('read-only port cannot collect'),
    check() {},
    remove() {},
  };
  const port = new PostgresResourceCatalog(pool, 'module-a', true, cleanup).service();
  assert.equal(port.database, undefined);
  assert.equal(port.cleanup, undefined);
  assert.equal(Object.getPrototypeOf(port), Object.prototype);
  assert.equal(Object.isFrozen(port), true);
  const forged = new PostgresResourceCatalog(pool, 'module-b', false, cleanup);
  await assert.rejects(port.retain.call(forged, 'owner', ['key']), { code: 'read_only' });
  await assert.rejects(port.collect.call(forged, 0, 1), { code: 'read_only' });
});

test('resource catalog rejects invalid input and read-only writes before acquiring a connection', async () => {
  const pool = { connect: () => assert.fail('validation must precede database work') };
  const cleanup = { run: () => assert.fail('no cleanup'), check() {}, remove() {} };
  const catalog = new PostgresResourceCatalog(pool, 'module-a', false, cleanup);
  await assert.rejects(catalog.retain('owner', ['x'.repeat(257)]), { code: 'invalid_input' });
  await assert.rejects(catalog.retain('owner', Array(1025).fill('key')), { code: 'invalid_input' });
  await assert.rejects(catalog.reserve('owner', null), { code: 'invalid_input' });
  await assert.rejects(
    catalog.reserve('owner', {
      key: 'key',
      name: '../other/file',
      sources: [],
      metadata: new Uint8Array(),
    }),
    { code: 'invalid_input' },
  );
  await assert.rejects(catalog.collect(-1, 10), { code: 'invalid_input' });
  const reader = new PostgresResourceCatalog(pool, 'module-a', true, cleanup);
  await assert.rejects(reader.retain('owner', ['key']), { code: 'read_only' });
  await assert.rejects(reader.initialize(), { code: 'read_only' });
});
