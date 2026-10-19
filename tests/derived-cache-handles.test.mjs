import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GenerationBuild } from '../packages/infrastructure/dist/derived-cache-build.js';
import { readCacheManifest } from '../packages/infrastructure/dist/derived-cache-read.js';
import { removeTestDirectory } from './helpers.mjs';

// This file runs in its own node-test process. Top-level tests are serial; teardown
// restores both the promise API and named ESM imports before the next test starts.
async function fixture(t) {
  const directory = await fs.promises.mkdtemp(join(tmpdir(), 'arkvory-cache-handles-'));
  const originalOpen = fs.promises.open;
  const opened = [];
  const failure = new Error('injected manifest close failure');
  let failClose = false;
  let closeAttempts = 0;
  fs.promises.open = async (path, ...args) => {
    const handle = await originalOpen(path, ...args);
    const close = handle.close.bind(handle);
    opened.push({ path: String(path), handle, close });
    handle.close = async () => {
      closeAttempts++;
      if (failClose) throw failure; // Deliberately leave the real OS descriptor open.
      await close();
    };
    return handle;
  };
  syncBuiltinESMExports();
  t.after(async () => {
    fs.promises.open = originalOpen;
    syncBuiltinESMExports();
    // Safety cleanup uses the original close even when a regression loses its handle.
    try {
      for (const entry of opened) await entry.close();
    } finally {
      await removeTestDirectory(directory);
    }
  });
  return {
    directory,
    opened,
    failure,
    failClose: (value) => {
      failClose = value;
    },
    attempts: () => closeAttempts,
  };
}

function buildAt(directory, room = async () => {}) {
  const calls = { published: 0, retired: 0, settled: 0 };
  const signal = new AbortController().signal;
  const build = new GenerationBuild(directory, { bytes: 4096, files: 8 }, signal, {
    check() {},
    room,
    publish: async () => {
      calls.published++;
    },
    retire: async () => {
      calls.retired++;
    },
    settled: () => {
      calls.settled++;
    },
  });
  return { build, calls, signal };
}

test('derived cache manifest reserve refusal happens before open/write/publication', async (t) => {
  const f = await fixture(t);
  const failure = new Error('volume reserve exhausted');
  const requests = [];
  const { build, calls, signal } = buildAt(f.directory, async (bytes) => {
    requests.push(bytes);
    throw failure;
  });
  await assert.rejects(build.commit(signal), (error) => error === failure);
  assert.deepEqual(requests, [Buffer.byteLength('[]')]);
  assert.equal(f.opened.length, 0);
  assert.deepEqual(await fs.promises.readdir(f.directory), []);
  assert.equal(calls.published, 0);
  await build.quiesce();
});

test('derived cache build retains failed manifest close through failed quiesce then retries real close', async (t) => {
  const f = await fixture(t);
  const { build, calls, signal } = buildAt(f.directory);
  f.failClose(true);
  await assert.rejects(build.commit(signal), (error) => error === f.failure);
  assert.equal(f.opened.length, 1);
  const handle = f.opened[0].handle;
  assert.equal((await handle.stat()).size, 2, 'fault left the real descriptor usable');
  assert.equal(calls.published, 0);
  await assert.rejects(build.quiesce(), (error) => error === f.failure);
  assert.equal((await handle.stat()).size, 2, 'failed drain must still track this handle');
  assert.equal(f.attempts(), 2);
  f.failClose(false);
  await build.quiesce();
  assert.equal(f.attempts(), 3, 'retry closes the retained descriptor');
  assert.equal(handle.fd, -1);
  await assert.rejects(handle.stat(), { code: 'EBADF' });
  await build.quiesce();
  assert.equal(f.attempts(), 3, 'successful drain is idempotent');
  assert.equal(calls.retired, 0, 'quiesce itself never claims catalog cleanup');
});

test('derived cache abort does not retire a generation until manifest descriptor closes', async (t) => {
  const f = await fixture(t);
  const { build, calls, signal } = buildAt(f.directory);
  f.failClose(true);
  await assert.rejects(build.commit(signal), (error) => error === f.failure);
  await assert.rejects(build.abort(), (error) => error === f.failure);
  assert.equal(calls.retired, 0);
  assert.equal(calls.settled, 0);
  assert.equal((await f.opened[0].handle.stat()).size, 2);
  f.failClose(false);
  await build.abort();
  assert.equal(f.opened[0].handle.fd, -1);
  assert.equal(calls.retired, 1);
  assert.equal(calls.settled, 1);
  assert.equal(calls.published, 0);
});

test('derived cache manifest reader retains OS handle when close fails until owner drain', async (t) => {
  const f = await fixture(t);
  const bytes = Buffer.from('[]');
  await fs.promises.writeFile(join(f.directory, 'manifest'), bytes);
  const digest = createHash('sha256').update(bytes).digest('hex');
  const handles = new Set();
  f.failClose(true);
  await assert.rejects(
    readCacheManifest(f.directory, digest, handles),
    (error) => error === f.failure,
  );
  assert.equal(handles.size, 1);
  const [handle] = handles;
  assert.equal((await handle.stat()).size, bytes.length);
  await assert.rejects(handle.close(), (error) => error === f.failure);
  assert.equal(handles.has(handle), true, 'unsuccessful drain must retain the reference');
  f.failClose(false);
  // Same ownership rule as ModuleDerivedCache manifest drain: delete only after close.
  for (const retained of handles) {
    await retained.close();
    handles.delete(retained);
  }
  assert.equal(handle.fd, -1);
  await assert.rejects(handle.stat(), { code: 'EBADF' });
  assert.equal(handles.size, 0);
  assert.deepEqual(await readCacheManifest(f.directory, digest, handles), []);
  assert.equal(handles.size, 0, 'successful normal read releases its tracked descriptor');
});
