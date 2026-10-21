import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  PostgresResourceCatalog,
  ModuleRemoval,
  ModuleUnlinkAdmission,
  PostgresContentPins,
  PostgresModuleDataCoordinator,
  openModuleData,
} from '@proanima/arkvory-infrastructure';
import { setup } from './fixture.mjs';
import { resourceCatalogContract } from '@proanima/arkvory-extension-testkit';

async function fixture(t) {
  const cleanups = [];
  // Close module sessions before setup's pool teardown, otherwise pool.end waits forever.
  t.after(async () => {
    for (const close of cleanups.reverse()) await close();
  });
  const f = await setup(t);
  const removal = new ModuleRemoval();
  const admission = new ModuleUnlinkAdmission(f.catalog.sessions);
  const coordinator = new PostgresModuleDataCoordinator(f.catalog.sessions);
  const opened = await openModuleData({
    coordinator,
    dataDirectory: f.directory,
    moduleId: 'resource-test',
    quota: { bytes: 1024 ** 2, files: 100 },
    reserve: { bytes: 0, inodes: 0 },
    readOnly: false,
    requireRemoval: () => removal.require(),
  });
  cleanups.push(async () => {
    await opened.close();
    await coordinator.close();
  });
  const files = opened.directory.data;
  let beforeRemove = async () => {};
  const cleanup = {
    run: (work) => admission.run((check) => removal.collect(check, work)),
    check: () => removal.require(),
    remove: async (name) => {
      await beforeRemove(name);
      await files.remove(name);
    },
  };
  const create = (id = 'resource-test', ro = false) =>
    new PostgresResourceCatalog(f.catalog.pool, id, ro, cleanup);
  const catalog = create();
  const record = (key, suffix = 'one', sources = []) => ({
    key,
    name: `resources/${key}/${suffix}`,
    sources,
    metadata: Buffer.from(key),
  });
  const put = async (owner, file) => {
    await catalog.reserve(owner, file);
    const sink = await files.create(file.name, { durable: true, exclusive: true });
    await sink.write(Buffer.from('immutable resource bytes'));
    await sink.close();
    await catalog.publish(owner, file.name);
  };
  return {
    ...f,
    sessions: f.catalog.sessions,
    files,
    cleanup,
    create,
    catalog,
    record,
    put,
    release: (owner) => cleanup.run(() => catalog.release(owner)),
    beforeRemove: (fn) => {
      beforeRemove = fn;
    },
    after: (fn) => cleanups.push(fn),
  };
}

resourceCatalogContract('PostgreSQL resource catalog', async (t) => {
  const f = await fixture(t);
  return {
    first: f.catalog,
    second: f.create(),
    reader: f.create('resource-test', true),
    other: f.create('other-module'),
    write: f.put,
    closeOwner: f.release,
  };
});

test('resource catalog protects shared owners across adapters and permanently fences closed uploads', async (t) => {
  const f = await fixture(t),
    a = f.catalog,
    b = f.create();
  const file = f.record('shared');
  await a.initialize();
  await Promise.all([a.retain('first', ['shared']), b.retain('second', ['shared'])]);
  await f.put('first', file);
  await f.release('first');
  assert.equal(await b.collect(0, 10), 0);
  assert.ok(await f.files.stat(file.name));
  await assert.rejects(a.retain('first', ['shared']), { code: 'conflict' });
  await assert.rejects(a.publish('first', file.name), { code: 'conflict' });
  await f.release('second');
  assert.equal(await b.collect(0, 10), 1);
  assert.equal(await f.files.stat(file.name), null);
  assert.equal(await a.find('shared'), null);
});

test('resource catalog retries unlink faults and keeps source edges until every dependent file is gone', async (t) => {
  const f = await fixture(t),
    a = f.catalog;
  await a.initialize();
  const source = f.record('source');
  await f.put('owner', source);
  await f.put('owner', f.record('dependent', 'one', ['source']));
  await f.put('owner', f.record('dependent', 'two', ['source']));
  await f.release('owner');
  f.beforeRemove(async () => {
    throw new Error('injected_unlink_failure');
  });
  await assert.rejects(a.collect(0, 1), /injected_unlink_failure/);
  await assert.rejects(f.create().retain('late', ['dependent']), { code: 'busy' });
  assert.ok(await f.files.stat(source.name));
  f.beforeRemove(async () => {});
  assert.equal(await f.create().collect(0, 1), 1);
  assert.ok(await f.files.stat(source.name));
  assert.equal(await f.create().collect(0, 1), 1);
  assert.ok(await f.files.stat(source.name));
  assert.equal(await a.collect(0, 1), 1);
  assert.equal(await f.files.stat(source.name), null);
});

test('resource collection refuses a real core reader pin and excludes concurrent retention while unlink waits', async (t) => {
  const f = await fixture(t),
    a = f.catalog;
  await a.initialize();
  const file = f.record('raced');
  await f.put('owner', file);
  await f.release('owner');
  const pins = new PostgresContentPins(f.sessions);
  f.after(() => pins.close());
  const pin = await pins.acquire(randomUUID());
  await assert.rejects(a.collect(0, 1), { code: 'busy' });
  assert.ok(await f.files.stat(file.name));
  await pin.release();
  let entered, resume;
  const waiting = new Promise((done) => {
    entered = done;
  });
  const held = new Promise((done) => {
    resume = done;
  });
  f.beforeRemove(async () => {
    entered();
    await held;
  });
  const collecting = a.collect(0, 1);
  await waiting;
  try {
    await assert.rejects(f.create().retain('next', ['raced']), { code: 'busy' });
    await assert.rejects(pins.acquire(randomUUID()), { code: 'busy' });
  } finally {
    resume();
  }
  assert.equal(await collecting, 1);
  f.beforeRemove(async () => {});
  await f.put('next', f.record('raced', 'new-generation'));
  assert.equal(await a.collect(0, 10), 0);
  assert.equal((await a.find('raced')).name, 'resources/raced/new-generation');
});

test('resource rebuild remains closed on missing sources; namespaces and read-only roles cannot mutate', async (t) => {
  const f = await fixture(t),
    a = f.catalog;
  assert.equal(await a.ready(), false);
  await a.restore(f.record('dependent', 'restored', ['source']));
  await assert.rejects(a.initialize(), { code: 'unavailable' });
  assert.equal(await a.collect(0, 10), 0);
  await a.restore(f.record('source', 'restored'));
  await a.retain('restored-upload', ['dependent']);
  await a.initialize();
  assert.equal(await f.create().ready(), true);
  assert.equal(await f.create('other-module').find('source'), null);
  const reader = f.create('resource-test', true);
  assert.ok(await reader.find('source'));
  await assert.rejects(reader.retain('owner', ['source']), { code: 'read_only' });
  await assert.rejects(reader.collect(0, 1), { code: 'read_only' });
  await assert.rejects(reader.initialize(), { code: 'read_only' });
  await assert.rejects(a.release('restored-upload'), { code: 'busy' });
  await assert.rejects(a.restore(f.record('later')), { code: 'conflict' });
  await assert.rejects(a.reserve('bad', f.record('self', 'x', ['self'])), {
    code: 'invalid_input',
  });
});

test('canonical resource file stays stable across duplicate publications and failed reservations are reclaimed', async (t) => {
  const f = await fixture(t);
  await f.catalog.initialize();
  const first = f.record('same', 'z-first');
  await f.put('first-owner', first);
  await f.put('second-owner', f.record('same', 'a-later'));
  assert.equal((await f.create().find('same')).name, first.name);
  await f.release('first-owner');
  assert.equal(await f.catalog.collect(0, 10), 0);
  assert.equal((await f.create().find('same')).name, first.name);
  const pending = f.record('unfinished');
  await f.catalog.reserve('failed-writer', pending);
  assert.equal(await f.catalog.find('unfinished'), null);
  await f.release('failed-writer');
  await f.catalog.collect(0, 10);
  await assert.rejects(f.catalog.publish('failed-writer', pending.name), { code: 'conflict' });
  await f.put('new-owner', f.record('unfinished', 'after-failure'));
  assert.ok(await f.catalog.find('unfinished'));
  await f.release('second-owner');
  assert.equal(await f.catalog.collect(0, 10), 2);
  assert.equal(await f.files.stat(first.name), null);
});
