import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openModuleData } from '@proanima/arkvory-infrastructure';
import { removeTestDirectory } from './helpers.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'arkvory-module-recovery-'));
  t.after(() => removeTestDirectory(root));
  const base = join(root, 'module-data', 'recover');
  await mkdir(join(base, 'data'), { recursive: true });
  await writeFile(join(base, 'data', 'existing'), 'old');
  return {
    dataDirectory: root,
    moduleId: 'recover',
    quota: { bytes: 3, files: 1 },
    reserve: { bytes: 0, inodes: 0 },
    deferredAccounting: true,
  };
}

test('deferred reader serves existing bytes without accounting; unknown usage is busy', async (t) => {
  const opened = await openModuleData({ ...(await fixture(t)), readOnly: true });
  t.after(() => opened.close());
  const files = opened.directory.data;
  assert.throws(() => files.usage(), { code: 'busy' });
  const parts = [];
  for await (const bytes of files.read('existing')) parts.push(bytes);
  assert.equal(Buffer.concat(parts).toString(), 'old');
  await assert.rejects(files.create('new', { exclusive: true, durable: false }), {
    code: 'read_only',
  });
  await opened.reconcile();
  assert.equal(files.usage().bytes, 3);
});

test('deferred writer reads during guarded preparation but cannot reuse uncounted credit', async (t) => {
  const options = await fixture(t);
  const hold = Promise.withResolvers();
  const entered = Promise.withResolvers();
  let first = true;
  const opened = await openModuleData({
    ...options,
    readOnly: false,
    coordinator: {
      owner: randomUUID(),
      run: async (_id, work) => {
        if (first) {
          first = false;
          entered.resolve();
          await hold.promise;
        }
        return work({ check() {}, orphan: async () => {} });
      },
    },
  });
  t.after(async () => {
    hold.resolve();
    await opened.close();
  });
  await entered.promise;
  const files = opened.directory.data;
  assert.equal((await files.stat('existing')).size, 3);
  assert.throws(() => files.usage(), { code: 'busy' });
  let completed = false;
  const write = files.create('new', { exclusive: true, durable: false });
  const checked = assert.rejects(write, { code: 'module_quota_exceeded' }).then(() => {
    completed = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(completed, false);
  hold.resolve();
  await checked;
  assert.equal(files.usage().bytes, 3);
  assert.equal(await files.stat('new'), null);
});

test('deferred accounting retries startup contention without losing quota or blocking reads', async (t) => {
  const options = await fixture(t);
  let attempts = 0;
  let mutations = 0;
  const opened = await openModuleData({
    ...options,
    readOnly: false,
    coordinator: {
      owner: randomUUID(),
      run: async (_id, work) => {
        if (++attempts <= 2) throw Object.assign(new Error('contended'), { code: 'busy' });
        mutations++;
        return work({ check() {}, orphan: async () => {} });
      },
    },
  });
  t.after(() => opened.close());
  assert.equal((await opened.directory.data.stat('existing')).size, 3);
  await assert.rejects(opened.directory.data.create('new', { exclusive: true, durable: false }), {
    code: 'module_quota_exceeded',
  });
  assert.equal(opened.directory.data.usage().bytes, 3);
  assert.equal(mutations, 2, 'one preparation and one quota-rejected write');
});

test('shutdown cancels accounting lock retries before any mutation', async (t) => {
  const options = await fixture(t);
  const entered = Promise.withResolvers();
  let attempts = 0;
  const opened = await openModuleData({
    ...options,
    readOnly: false,
    coordinator: {
      owner: randomUUID(),
      run: async () => {
        attempts++;
        entered.resolve();
        throw Object.assign(new Error('contended'), { code: 'busy' });
      },
    },
  });
  await entered.promise;
  await opened.close();
  assert.equal(attempts, 1);
  await assert.rejects(opened.directory.data.create('new', { exclusive: true, durable: false }));
});
