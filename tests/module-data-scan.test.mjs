import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { setImmediate as turn } from 'node:timers/promises';
import { openModuleData } from '@proanima/arkvory-infrastructure';
import { removeTestDirectory } from './helpers.mjs';

async function fixture(t, mode) {
  const root = await mkdtemp(join(tmpdir(), 'arkvory-quota-scan-'));
  t.after(() => removeTestDirectory(root));
  const base = join(root, 'module-data', 'scan');
  const area = join(base, 'data');
  await mkdir(area, { recursive: true });
  for (let i = 0; i < 20; i++) await writeFile(join(area, String(i)), Buffer.alloc(i + 1));
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const state = { active: 0, peak: 0 };
  const original = fs.promises.lstat;
  fs.promises.lstat = async (path, ...args) => {
    if (typeof path !== 'string' || !path.startsWith(area + sep)) return original(path, ...args);
    state.active++;
    state.peak = Math.max(state.peak, state.active);
    if (state.active === 8) entered.resolve();
    try {
      if (mode === 'cancel') await release.promise;
      else await turn();
      if (mode === 'fault') throw new Error('scan fault');
      return await original(path, ...args);
    } finally {
      state.active--;
    }
  };
  syncBuiltinESMExports();
  t.after(() => {
    release.resolve();
    fs.promises.lstat = original;
    syncBuiltinESMExports();
  });
  return {
    base,
    state,
    entered,
    release,
    options: {
      dataDirectory: root,
      moduleId: 'scan',
      quota: { bytes: 210, files: 20 },
      reserve: { bytes: 0, inodes: 0 },
      readOnly: false,
      coordinator: {
        owner: randomUUID(),
        run: async (_id, work) => work({ check() {}, orphan: async () => {} }),
      },
    },
  };
}

test('quota reconciliation bounds stats and retains exact byte/file admission', async (t) => {
  const f = await fixture(t);
  const data = await openModuleData(f.options);
  t.after(() => data.close());
  assert.ok(f.state.peak > 1 && f.state.peak <= 8);
  assert.equal(f.state.active, 0);
  assert.deepEqual(data.directory.data.usage(), {
    bytes: 210,
    files: 20,
    quotaBytes: 210,
    quotaFiles: 20,
  });
  await assert.rejects(
    data.directory.data.create('overflow', { durable: false, exclusive: true }),
    { code: 'module_quota_exceeded' },
  );
});

test('quota scan failure drains stats without committing partial accounting', async (t) => {
  const f = await fixture(t, 'fault');
  await assert.rejects(openModuleData(f.options), /scan fault/);
  assert.equal(f.state.active, 0);
  await assert.rejects(readFile(join(f.base, '.accounting.json')), { code: 'ENOENT' });
});

test('closing recovery waits for cancelled scan stats and publishes no partial credit', async (t) => {
  const f = await fixture(t, 'cancel');
  const data = await openModuleData({ ...f.options, deferredAccounting: true });
  t.after(async () => {
    f.release.resolve();
    await data.close();
  });
  await f.entered.promise;
  let closed = false;
  const closing = data.close().then(() => {
    closed = true;
  });
  await turn();
  assert.equal(closed, false);
  f.release.resolve();
  await closing;
  assert.equal(f.state.active, 0);
  assert.throws(() => data.directory.data.usage());
  await assert.rejects(readFile(join(f.base, '.accounting.json')), { code: 'ENOENT' });
});
