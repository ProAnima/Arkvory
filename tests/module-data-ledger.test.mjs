import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtemp, mkdir, writeFile, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openModuleData } from '@proanima/arkvory-infrastructure';
import { removeTestDirectory } from './helpers.mjs';

const options = { durable: false, exclusive: false };
async function fixture(t, prefill = 0) {
  const root = await mkdtemp(join(tmpdir(), 'arkvory-data-ledger-'));
  const base = join(root, 'module-data', 'test-ledger');
  await mkdir(join(base, 'data'), { recursive: true });
  for (let i = 0; i < prefill; i++) await writeFile(join(base, 'data', String(i)), 'x');
  const opened = await openModuleData({
    dataDirectory: root,
    moduleId: 'test-ledger',
    quota: { bytes: 10000, files: 2000 },
    reserve: { bytes: 0, inodes: 0 },
    readOnly: false,
    coordinator: {
      owner: randomUUID(),
      run: async (_id, work) =>
        work({
          check() {},
          orphan: async () => {},
        }),
    },
  });
  t.after(async () => {
    await opened.close();
    await removeTestDirectory(root);
  });
  return { ...opened, base, data: opened.directory.data };
}

function replaceBuiltin(t, name, wrapper) {
  const original = fs.promises[name];
  fs.promises[name] = wrapper(original);
  syncBuiltinESMExports();
  t.after(() => {
    fs.promises[name] = original;
    syncBuiltinESMExports();
  });
}

test('streaming chunks do not traverse the published tree or the temporary files', async (t) => {
  const f = await fixture(t, 1000);
  const walks = [];
  replaceBuiltin(t, 'readdir', (original) => async (path, ...args) => {
    walks.push(String(path));
    return original(path, ...args);
  });
  const sink = await f.data.create('stream', options);
  for (let i = 0; i < 32; i++) await sink.write(Buffer.alloc(10));
  await sink.close();
  assert.equal(f.data.usage().bytes, 1320);
  assert.equal(f.data.usage().files, 1001);
  assert.ok(walks.length > 0);
  assert.ok(
    walks.every((path) => path === join(f.base, 'tmp', 'coordinated-v1')),
    'only the bounded-by-hosts owner directory is enumerated, never files per chunk',
  );
});

for (const afterClose of [false, true]) {
  test(`failed close ${afterClose ? 'after' : 'before'} OS close discards without publication`, async (t) => {
    const f = await fixture(t);
    let calls = 0;
    replaceBuiltin(t, 'open', (original) => async (path, ...args) => {
      const handle = await original(path, ...args);
      if (String(path).includes(join('tmp', 'coordinated-v1'))) {
        const close = handle.close.bind(handle);
        handle.close = async () => {
          calls++;
          if (calls === 1) {
            if (afterClose) await close();
            throw new Error('injected close failure');
          }
          await close();
        };
      }
      return handle;
    });
    const sink = await f.data.create('unpublished', options);
    await sink.write(Buffer.alloc(7));
    await assert.rejects(sink.close(), /injected close failure/);
    assert.equal(calls, 2);
    assert.equal(await f.data.stat('unpublished'), null);
    const ledger = JSON.parse(await readFile(join(f.base, '.accounting.json'), 'utf8'));
    assert.equal(ledger.temporaryBytes, 0);
    assert.equal(ledger.temporaryFiles, 0);
    const owners = await readdir(join(f.base, 'tmp', 'coordinated-v1'));
    for (const owner of owners)
      assert.deepEqual(await readdir(join(f.base, 'tmp', 'coordinated-v1', owner)), []);
    await sink.abort();
    assert.equal(calls, 2, 'a successfully closed handle is not closed again');
  });
}

test('an interrupted ledger forces reconciliation before admitting another reservation', async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.base, '.accounting.dirty'), '1');
  await writeFile(join(f.base, 'data', 'after-interruption'), Buffer.alloc(9999));
  const sink = await f.data.create('next', options);
  await assert.rejects(sink.write(Buffer.alloc(2)), { code: 'module_quota_exceeded' });
  assert.equal(f.data.usage().bytes, 9999);
  await assert.rejects(readFile(join(f.base, '.accounting.dirty')), { code: 'ENOENT' });
});

test('repeated close failure retains the sink and its charged reservation for cleanup retry', async (t) => {
  const f = await fixture(t);
  let calls = 0;
  replaceBuiltin(t, 'open', (original) => async (path, ...args) => {
    const handle = await original(path, ...args);
    if (String(path).includes(join('tmp', 'coordinated-v1'))) {
      const close = handle.close.bind(handle);
      handle.close = async () => {
        if (++calls <= 2) throw new Error('close unavailable');
        await close();
      };
    }
    return handle;
  });
  const sink = await f.data.create('unpublished', options);
  await sink.write(Buffer.alloc(7));
  await assert.rejects(sink.close(), /close unavailable/);
  const ledger = JSON.parse(await readFile(join(f.base, '.accounting.json'), 'utf8'));
  assert.equal(ledger.temporaryBytes, 7);
  assert.equal(ledger.temporaryFiles, 1);
  await f.close();
  assert.equal(calls, 3);
  assert.equal(await f.data.stat('unpublished'), null);
});
