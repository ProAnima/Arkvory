import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeTestDirectory } from './helpers.mjs';
import { LocalBlobStore } from '@proanima/arkvory-infrastructure';

const cancellation = { throwIfAborted() {} };
const descriptor = (data) => ({
  name: 'a.bin',
  size: data.length,
  sha256: createHash('sha256').update(data).digest('hex'),
  labels: [],
  metadata: {},
});
async function* chunks(data) {
  for (let start = 0; start < data.length; start += 3) yield data.subarray(start, start + 3);
}
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'arkvory-blob-'));
  t.after(() => removeTestDirectory(root));
  const store = new LocalBlobStore(root, 0);
  await store.initialize();
  return { root, store };
}

test('local blob publication survives adapter restart and preserves exact Range bytes', async (t) => {
  const { root, store } = await fixture(t);
  const id = randomUUID();
  const data = Buffer.from('original immutable content');
  await store.put(id, descriptor(data), chunks(data), cancellation);
  const restarted = new LocalBlobStore(root, 0);
  await restarted.verify(id, descriptor(data), cancellation);
  const parts = [];
  for await (const part of restarted.read(id, data.length, { start: 3, end: 8 })) parts.push(part);
  assert.equal(Buffer.concat(parts).toString(), data.subarray(3, 9).toString());
  await restarted.put(id, descriptor(data), chunks(data), cancellation);
  assert.deepEqual(await readFile(join(root, 'blobs', id)), data);
});

test('truncated, oversized, aborted and corrupted transfers never publish', async (t) => {
  const { root, store } = await fixture(t);
  const data = Buffer.from('expected');
  for (const bytes of [
    Buffer.from('bad'),
    Buffer.from('unexpected extra'),
    Buffer.from('changed!'),
  ]) {
    const id = randomUUID();
    await assert.rejects(store.put(id, descriptor(data), chunks(bytes), cancellation), {
      code: 'integrity_mismatch',
    });
    await assert.rejects(store.exists(id, data.length), { code: 'unavailable' });
  }
  const id = randomUUID();
  let reads = 0;
  await assert.rejects(
    store.put(id, descriptor(data), chunks(data), {
      throwIfAborted() {
        if (++reads > 2) throw new Error('cancelled');
      },
    }),
    /cancelled/,
  );
  await assert.rejects(store.exists(id, data.length));
  await store.put(id, descriptor(data), chunks(data), cancellation);
  await writeFile(join(root, 'blobs', id), Buffer.from('corrupt!'));
  await assert.rejects(store.verify(id, descriptor(data), cancellation), {
    code: 'integrity_mismatch',
  });
});

test('blob IDs cannot escape storage and zero-byte objects are valid', async (t) => {
  const { store } = await fixture(t);
  const id = randomUUID();
  const data = Buffer.alloc(0);
  await store.put(id, descriptor(data), chunks(data), cancellation);
  await store.verify(id, descriptor(data), cancellation);
  await assert.rejects(store.exists('../../x', 0), { code: 'invalid_input' });
});

test('short blob reads fail for full content, Range and multipart assembly', async (t) => {
  const { root, store } = await fixture(t);
  const bytes = Buffer.from('complete content');
  const id = randomUUID();
  await store.put(id, descriptor(bytes), chunks(bytes), cancellation);
  await store.exists(id, bytes.length);
  await truncate(join(root, 'blobs', id), 4);
  const consume = async (source) => {
    for await (const _chunk of source) {
      /* Drain to EOF. */
    }
  };
  await assert.rejects(consume(store.read(id, bytes.length)), { code: 'integrity_mismatch' });
  await assert.rejects(consume(store.read(id, bytes.length, { start: 2, end: 10 })), {
    code: 'integrity_mismatch',
  });
  const part = { index: 0, size: bytes.length, sha256: descriptor(bytes).sha256 };
  await store.putPart(id, part, chunks(bytes), cancellation);
  await truncate(join(root, 'parts', id, `0-${part.sha256}`), 4);
  await assert.rejects(consume(store.readParts(id, [part])), { code: 'integrity_mismatch' });
});

test('a staged file becomes the blob without a copy, only with its own measured bytes', async (t) => {
  const { stagedFile } = await import('../packages/infrastructure/dist/blob-files.js');
  const { stat, mkdir } = await import('node:fs/promises');
  const { root, store } = await fixture(t);
  await mkdir(join(root, 'raw-staging'));
  const stage = async (data) => {
    const path = join(root, 'raw-staging', randomUUID());
    await writeFile(path, data, { mode: 0o600 });
    return path;
  };
  const data = Buffer.from('staged and adopted bytes');
  const expected = descriptor(data);
  const measured = { size: expected.size, sha256: expected.sha256 };
  // Measured while staging: adopted as is, a second name of the same file.
  const path = await stage(data);
  const staged = await stat(path, { bigint: true });
  const id = randomUUID();
  await store.put(
    id,
    expected,
    stagedFile(path, () => chunks(data), measured),
    cancellation,
  );
  const blob = await stat(join(root, 'blobs', id), { bigint: true });
  assert.equal(blob.ino, staged.ino, 'no copy');
  assert.deepEqual(await readFile(join(root, 'blobs', id)), data);
  // The staged name is gone: a retried write through it makes a new file, the blob stays.
  await assert.rejects(stat(path), { code: 'ENOENT' });
  await writeFile(path, 'a retry of the last chunk', { flag: 'w' });
  assert.deepEqual(await readFile(join(root, 'blobs', id)), data);
  assert.equal(blob.nlink, 1n, 'no other name reaches the published bytes');
  // Not measured (an appended OCI blob): hashed once in place, then adopted.
  const unmeasured = await stage(data);
  const unmeasuredIno = (await stat(unmeasured, { bigint: true })).ino;
  const second = randomUUID();
  await store.put(
    second,
    expected,
    stagedFile(unmeasured, () => chunks(data)),
    cancellation,
  );
  assert.equal((await stat(join(root, 'blobs', second), { bigint: true })).ino, unmeasuredIno);
  // Bytes that differ from the declaration never become a blob.
  const other = Buffer.from('staged and adopted bytez');
  for (const [file, staged] of [
    [await stage(other), (p) => stagedFile(p, () => chunks(other))],
    [await stage(data), (p) => stagedFile(p, () => chunks(data), { ...measured, size: 1 })],
  ]) {
    const refused = randomUUID();
    await assert.rejects(store.put(refused, expected, staged(file), cancellation), {
      code: 'integrity_mismatch',
    });
    await assert.rejects(stat(join(root, 'blobs', refused)), { code: 'ENOENT' });
    // A refused file is back under its staged name: the upload may still be completed.
    assert.ok((await stat(file)).isFile());
  }
  const { readdir } = await import('node:fs/promises');
  assert.deepEqual(
    (await readdir(join(root, 'raw-staging'))).filter((name) => name.includes('.adopting-')),
    [],
  );
  // No staged file (an empty OCI blob): written from the stream as before.
  const empty = Buffer.alloc(0);
  const third = randomUUID();
  await store.put(
    third,
    descriptor(empty),
    stagedFile(join(root, 'raw-staging', 'missing'), () => chunks(empty)),
    cancellation,
  );
  assert.equal((await readFile(join(root, 'blobs', third))).length, 0);
});

test('adopting a staged file needs no free space; copying the same bytes does', async (t) => {
  const { stagedFile } = await import('../packages/infrastructure/dist/blob-files.js');
  const { mkdir } = await import('node:fs/promises');
  const root = await mkdtemp(join(tmpdir(), 'arkvory-blob-full-'));
  t.after(() => removeTestDirectory(root));
  // A reserve no volume has: every write that needs new space is refused.
  const store = new LocalBlobStore(root, Number.MAX_SAFE_INTEGER);
  await store.initialize();
  await mkdir(join(root, 'raw-staging'));
  const data = Buffer.from('bytes already on this volume');
  const path = join(root, 'raw-staging', randomUUID());
  await writeFile(path, data, { mode: 0o600 });
  const expected = descriptor(data);
  const id = randomUUID();
  await store.put(
    id,
    expected,
    stagedFile(path, () => chunks(data)),
    cancellation,
  );
  assert.deepEqual(await readFile(join(root, 'blobs', id)), data);
  await assert.rejects(store.put(randomUUID(), expected, chunks(data), cancellation), {
    code: 'capacity_exceeded',
  });
});
