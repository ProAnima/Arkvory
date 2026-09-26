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
