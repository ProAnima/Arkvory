import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { BackupFailure, inventoryLine, parseInventoryEntry } from '@proanima/arkvory-domain';
import { LocalContentSource, LocalRestoreStorage } from '@proanima/arkvory-infrastructure';
import { MemoryBlobStore } from './memory-blobs.mjs';

test('inventory lines carry a non-default storage and keep the old form for the default', () => {
  const id = randomUUID(),
    sha256 = 'a'.repeat(64);
  const plain = { id, size: 5, sha256 };
  assert.equal(inventoryLine(plain), JSON.stringify({ id, size: '5', sha256 }));
  assert.equal(inventoryLine({ ...plain, backend: 'default' }), inventoryLine(plain));
  const placed = inventoryLine({ ...plain, backend: 'volume-2' });
  assert.deepEqual(JSON.parse(placed), { id, size: '5', sha256, backend: 'volume-2' });
  assert.deepEqual(parseInventoryEntry(JSON.parse(placed)), { ...plain, backend: 'volume-2' });
  const line = { id, size: '5', sha256 };
  assert.deepEqual(parseInventoryEntry(line), plain);
  assert.deepEqual(parseInventoryEntry({ ...line, backend: 'default' }), plain);
  assert.deepEqual(parseInventoryEntry({ ...line, backend: 'module.cold' }), {
    ...plain,
    backend: 'module.cold',
  });
  for (const backend of ['', 'Volume', '../x', 'a'.repeat(65), 7, null])
    assert.throws(() => parseInventoryEntry({ ...line, backend }), BackupFailure);
  assert.throws(() => parseInventoryEntry({ ...line, extra: 'x' }), BackupFailure);
});

test('capture and restore read and write the storage named by the inventory, without paths', async () => {
  const source = new MemoryBlobStore();
  const bytes = Buffer.from('content of volume 2');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const entry = { id: randomUUID(), size: bytes.length, sha256, backend: 'volume-2' };
  source.place(entry.id, bytes, 'volume-2');
  const content = new LocalContentSource(source);
  const chunks = [];
  for await (const chunk of content.read(entry)) chunks.push(chunk);
  assert.deepEqual(Buffer.concat(chunks), bytes);
  assert.equal(source.reads[0].backendId, 'volume-2');
  // A blob the port reports unavailable is missing from the point, not skipped.
  const absent = { ...entry, id: randomUUID() };
  await assert.rejects(
    async () => {
      for await (const chunk of content.read(absent)) assert.ok(chunk);
    },
    { code: 'blob_missing' },
  );
  const target = new MemoryBlobStore();
  const restore = new LocalRestoreStorage(target);
  await restore.requireEmpty();
  assert.equal(await restore.prepare(), await target.identity());
  await restore.put(entry, content.read(entry), { throwIfAborted() {} });
  assert.deepEqual(target.bytesOf(entry.id), bytes);
  await target.exists(entry.id, entry.size, 'volume-2');
  await assert.rejects(restore.requireEmpty(), { code: 'target_not_empty' });
});
