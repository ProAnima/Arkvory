import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openModuleData } from '@proanima/arkvory-infrastructure';
import { removeTestDirectory } from './helpers.mjs';

// Races and stale credits of the data directory's accounting (ADR 0083, N6).
async function scratch(t, prefix) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => removeTestDirectory(directory));
  return directory;
}

const MIB = 1024 * 1024;
const roomy = async () => ({ bavail: 1n << 40n, bsize: 1n, files: 0n, ffree: 0n });
const quotaRefusal = { code: 'module_quota_exceeded' };
const replaceable = { durable: false, exclusive: false };

async function moduleData(t, quota) {
  const dataDirectory = await scratch(t, 'arkvory-module-data-');
  const data = await openModuleData({
    dataDirectory,
    moduleId: 'op-index',
    quota,
    reserve: { bytes: 0, inodes: 0 },
    readOnly: false,
    probe: roomy,
  });
  return { ...data, area: join(dataDirectory, 'module-data', 'op-index', 'data') };
}

async function put(files, name, size) {
  const sink = await files.create(name, replaceable);
  await sink.write(Buffer.alloc(size));
  await sink.close();
}

/** The usage the port reports, then what the disk holds. */
async function counted(data) {
  const reported = data.directory.data.usage();
  await data.reconcile();
  return { reported, disk: data.directory.data.usage() };
}

test('concurrent creates cannot pass the file quota together', async (t) => {
  const data = await moduleData(t, { bytes: 1000, files: 1 });
  const made = await Promise.allSettled(
    ['a', 'b'].map((name) => data.directory.data.create(name, replaceable)),
  );
  for (const result of made) if (result.status === 'fulfilled') await result.value.abort();
  assert.deepEqual(made.map((result) => result.status).sort(), ['fulfilled', 'rejected']);
  assert.equal(
    made.find((result) => result.status === 'rejected')?.reason.code,
    'module_quota_exceeded',
  );
});

test('concurrent writes cannot pass the byte quota while the volume is checked', async (t) => {
  // A write of 64 MiB waits for the volume check; the other write must already see its bytes.
  const data = await moduleData(t, { bytes: 100 * MIB, files: 10 });
  const sinks = await Promise.all(
    ['a', 'b'].map((name) => data.directory.data.create(name, replaceable)),
  );
  const chunk = Buffer.alloc(64 * MIB);
  const written = await Promise.allSettled(sinks.map((sink) => sink.write(chunk)));
  for (const sink of sinks) await sink.close().catch(() => undefined);
  assert.deepEqual(written.map((result) => result.status).sort(), ['fulfilled', 'rejected']);
  assert.ok(data.directory.data.usage().bytes <= 100 * MIB);
});

test('a rename onto the same file, by name or by case, keeps the counts', async (t) => {
  const data = await moduleData(t, { bytes: 1000, files: 10 });
  await put(data.directory.data, 'a', 600);
  await data.directory.data.rename('a', 'a');
  // Another case is the same file on NTFS and APFS, another file elsewhere: counts stay exact.
  await data.directory.data.rename('a', 'A');
  const { reported, disk } = await counted(data);
  assert.deepEqual(reported, disk);
  assert.deepEqual(reported, { bytes: 600, files: 1, quotaBytes: 1000, quotaFiles: 10 });
});

test('the credit of a replaced file ends when the file is removed before the close', async (t) => {
  const data = await moduleData(t, { bytes: 1000, files: 10 });
  await put(data.directory.data, 'a', 900);
  const sink = await data.directory.data.create('a', replaceable);
  await data.directory.data.remove('a');
  await assert.rejects(async () => {
    await sink.write(Buffer.alloc(1800));
    await sink.close();
  }, quotaRefusal);
  assert.deepEqual(await counted(data), {
    reported: { bytes: 0, files: 0, quotaBytes: 1000, quotaFiles: 10 },
    disk: { bytes: 0, files: 0, quotaBytes: 1000, quotaFiles: 10 },
  });
});

test('a file that replaced nothing at its close is counted against the file quota', async (t) => {
  const data = await moduleData(t, { bytes: 1000, files: 1 });
  await put(data.directory.data, 'a', 1);
  const sink = await data.directory.data.create('a', replaceable);
  await data.directory.data.remove('a');
  await put(data.directory.data, 'b', 1);
  await sink.write(Buffer.alloc(1));
  await assert.rejects(sink.close(), quotaRefusal);
  assert.equal(data.directory.data.usage().files, 1);
});

test('two closes replacing one name count only the file that stays', async (t) => {
  const data = await moduleData(t, { bytes: 1000, files: 10 });
  await put(data.directory.data, 'a', 900);
  const first = await data.directory.data.create('a', replaceable);
  const second = await data.directory.data.create('a', replaceable);
  await second.write(Buffer.alloc(10));
  await Promise.all([first.close(), second.close()]);
  const { reported, disk } = await counted(data);
  assert.deepEqual(reported, disk);
});

test('a reconciliation keeps a file published during its walk', async (t) => {
  const data = await moduleData(t, { bytes: 1000, files: 1000 });
  // Enough files that the walk is still running when the close publishes.
  await mkdir(join(data.area, 'z'));
  for (let index = 0; index < 500; index++) await writeFile(join(data.area, 'z', `${index}`), '');
  await data.reconcile();
  const sink = await data.directory.data.create('a', replaceable);
  await sink.write(Buffer.alloc(7));
  const walking = data.reconcile();
  await sink.close();
  await walking;
  const { reported, disk } = await counted(data);
  assert.deepEqual(reported, disk);
  assert.equal(reported.files, 501);
});

/**
 * Replaces `path` with `replacement` right before the process opens it: the read checked the
 * old file, the open gets the new one. Covers both the callback `open` of read streams and the
 * promise `open`; the ESM bindings of the built-in module are refreshed for the code under test.
 */
function replaceOnOpen(t, path, replacement) {
  const callbackOpen = fs.open;
  const promiseOpen = fs.promises.open;
  let armed = true;
  const swap = (target) => {
    if (armed && target === path) {
      armed = false;
      fs.renameSync(replacement, path);
    }
  };
  fs.open = (target, ...rest) => {
    swap(target);
    return callbackOpen(target, ...rest);
  };
  fs.promises.open = (target, ...rest) => {
    swap(target);
    return promiseOpen(target, ...rest);
  };
  syncBuiltinESMExports();
  t.after(() => {
    fs.open = callbackOpen;
    fs.promises.open = promiseOpen;
    syncBuiltinESMExports();
  });
}

test('a ranged read never returns fewer bytes of another version of the file', async (t) => {
  const data = await moduleData(t, { bytes: 10_000, files: 10 });
  await put(data.directory.data, 'a', 900);
  const replacement = join(data.area, '..', 'replacement');
  await writeFile(replacement, Buffer.alloc(4));
  replaceOnOpen(t, join(data.area, 'a'), replacement);
  let received = 0;
  const reading = (async () => {
    for await (const chunk of data.directory.data.read('a', { start: 0, end: 899 }))
      received += chunk.byteLength;
  })();
  // Either the exact range of one version or a refusal; never a silent short read.
  await reading.then(
    () => assert.equal(received, 900),
    (error) => assert.equal(error.code, 'invalid_input'),
  );
});
