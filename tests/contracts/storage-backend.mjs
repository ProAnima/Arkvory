import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';

/**
 * The contract every storage passes (ADR 0079, section 7 `blob-store`; LSP): what the core
 * relies on from a storage, through the port and its lifecycle only. `open(t)` returns a fresh,
 * empty storage `{ blobs, lifecycle, backendId, reopen }` whose `reopen()` gives another handle
 * on the same data, as after a restart. It is the suite of `extension-testkit` once that package
 * exists; until then core tests run it against each storage of the core and the test storage.
 */
export function storageBackendContract(name, open) {
  const cancellation = { throwIfAborted() {} };
  const descriptor = (bytes) => ({
    name: 'a.bin',
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    labels: [],
    metadata: {},
  });
  async function* chunks(bytes, size = 7) {
    for (let at = 0; at < bytes.length; at += size) yield bytes.subarray(at, at + size);
  }
  const gather = async (source) => {
    const parts = [];
    for await (const chunk of source) parts.push(Buffer.from(chunk));
    return Buffer.concat(parts);
  };
  const bytes = Buffer.from('immutable content of the contract suite, 0123456789');

  test(`${name}: lifecycle — empty, idempotent initialize, ready, stable identity`, async (t) => {
    const { lifecycle, reopen } = await open(t);
    await lifecycle.requireEmpty();
    await lifecycle.initialize();
    await lifecycle.initialize();
    await lifecycle.ready();
    const identity = await lifecycle.identity();
    assert.match(identity, /^[0-9a-f-]{36}$/);
    assert.equal(await lifecycle.identity(true), identity);
    assert.equal(await reopen().lifecycle.identity(true), identity, 'identity survives a restart');
    await lifecycle.checkSpace(0);
  });

  test(`${name}: put is immutable and verified, reads are exact with and without Range`, async (t) => {
    const { blobs, lifecycle, backendId, reopen } = await open(t);
    await lifecycle.initialize();
    const id = randomUUID();
    await blobs.put(id, descriptor(bytes), chunks(bytes), cancellation, backendId);
    const again = reopen().blobs;
    assert.deepEqual(await gather(again.read(id, bytes.length, undefined, backendId)), bytes);
    for (const [start, end] of [
      [0, 0],
      [3, 8],
      [bytes.length - 1, bytes.length - 1],
      [0, bytes.length - 1],
    ])
      assert.deepEqual(
        await gather(again.read(id, bytes.length, { start, end }, backendId)),
        bytes.subarray(start, end + 1),
      );
    await again.exists(id, bytes.length, backendId);
    await again.verify(id, descriptor(bytes), cancellation, backendId);
    // A repeated put of the same content succeeds; other content under the id is refused.
    await blobs.put(id, descriptor(bytes), chunks(bytes), cancellation, backendId);
    const other = Buffer.from('other content');
    await assert.rejects(blobs.put(id, descriptor(other), chunks(other), cancellation, backendId), {
      code: 'integrity_mismatch',
    });
    assert.deepEqual(await gather(blobs.read(id, bytes.length, undefined, backendId)), bytes);
    await assert.rejects(lifecycle.requireEmpty(), { code: 'conflict' });
  });

  test(`${name}: a declaration that the bytes do not match never becomes visible`, async (t) => {
    const { blobs, lifecycle, backendId } = await open(t);
    await lifecycle.initialize();
    const id = randomUUID();
    const wrong = { ...descriptor(bytes), sha256: 'f'.repeat(64) };
    await assert.rejects(blobs.put(id, wrong, chunks(bytes), cancellation, backendId), {
      code: 'integrity_mismatch',
    });
    const short = { ...descriptor(bytes), size: bytes.length + 1 };
    await assert.rejects(blobs.put(id, short, chunks(bytes), cancellation, backendId), {
      code: 'integrity_mismatch',
    });
    const long = { ...descriptor(bytes), size: bytes.length - 1 };
    await assert.rejects(blobs.put(id, long, chunks(bytes), cancellation, backendId), {
      code: 'integrity_mismatch',
    });
    await assert.rejects(blobs.exists(id, bytes.length, backendId), { code: 'unavailable' });
  });

  test(`${name}: missing content is unavailable, never a file system error`, async (t) => {
    const { blobs, lifecycle, backendId } = await open(t);
    await lifecycle.initialize();
    const id = randomUUID();
    await assert.rejects(blobs.exists(id, 1, backendId), { code: 'unavailable' });
    await assert.rejects(gather(blobs.read(id, 1, undefined, backendId)), {
      code: 'unavailable',
    });
    await assert.rejects(blobs.verify(id, descriptor(bytes), cancellation, backendId), {
      code: 'unavailable',
    });
    await blobs.put(id, descriptor(bytes), chunks(bytes), cancellation, backendId);
    await assert.rejects(blobs.exists(id, bytes.length + 1, backendId), { code: 'unavailable' });
  });

  test(`${name}: cancellation stops a write before it becomes visible`, async (t) => {
    const { blobs, lifecycle, backendId } = await open(t);
    await lifecycle.initialize();
    const id = randomUUID();
    let calls = 0;
    const stop = new Error('stopped');
    const cancelling = {
      throwIfAborted() {
        if (++calls > 2) throw stop;
      },
    };
    await assert.rejects(
      blobs.put(id, descriptor(bytes), chunks(bytes, 3), cancelling, backendId),
      (error) => error === stop,
    );
    await assert.rejects(blobs.exists(id, bytes.length, backendId), { code: 'unavailable' });
    // The id stays usable: a later complete put publishes it.
    await blobs.put(id, descriptor(bytes), chunks(bytes), cancellation, backendId);
    await blobs.exists(id, bytes.length, backendId);
  });

  test(`${name}: a reader that stops early leaves the content readable`, async (t) => {
    const { blobs, lifecycle, backendId } = await open(t);
    await lifecycle.initialize();
    const large = Buffer.alloc(3 * 1024 * 1024, 7);
    const id = randomUUID();
    await blobs.put(id, descriptor(large), chunks(large, 256 * 1024), cancellation, backendId);
    for await (const chunk of blobs.read(id, large.length, undefined, backendId)) {
      assert.ok(chunk.byteLength > 0);
      break;
    }
    assert.equal(
      (await gather(blobs.read(id, large.length, undefined, backendId))).length,
      large.length,
    );
  });

  test(`${name}: parts are kept until collected; collect is idempotent`, async (t) => {
    const { blobs, lifecycle, backendId } = await open(t);
    await lifecycle.initialize();
    const id = randomUUID();
    const halves = [bytes.subarray(0, 20), bytes.subarray(20)];
    const parts = halves.map((half, index) => ({
      index,
      size: half.length,
      sha256: createHash('sha256').update(half).digest('hex'),
    }));
    for (const [index, half] of halves.entries())
      await blobs.putPart(id, parts[index], chunks(half), cancellation, backendId);
    await assert.rejects(
      blobs.putPart(
        id,
        { ...parts[0], sha256: 'e'.repeat(64) },
        chunks(halves[0]),
        cancellation,
        backendId,
      ),
      { code: 'integrity_mismatch' },
    );
    assert.deepEqual(await gather(blobs.readParts(id, parts, backendId)), bytes);
    await blobs.put(
      id,
      descriptor(bytes),
      blobs.readParts(id, parts, backendId),
      cancellation,
      backendId,
    );
    await blobs.collect(id, false, cancellation, backendId);
    await blobs.collect(id, false, cancellation, backendId);
    await blobs.exists(id, bytes.length, backendId);
    await assert.rejects(gather(blobs.readParts(id, parts, backendId)));
    await blobs.collect(id, true, cancellation, backendId);
    await blobs.collect(id, true, cancellation, backendId);
    await assert.rejects(blobs.exists(id, bytes.length, backendId), { code: 'unavailable' });
  });

  test(`${name}: duplicate shares content under a new id inside the storage`, async (t) => {
    const { blobs, lifecycle, backendId } = await open(t);
    await lifecycle.initialize();
    const source = randomUUID();
    const target = randomUUID();
    await blobs.put(source, descriptor(bytes), chunks(bytes), cancellation, backendId);
    await blobs.duplicate(source, target, descriptor(bytes), cancellation, backendId);
    await blobs.duplicate(source, target, descriptor(bytes), cancellation, backendId);
    await blobs.collect(source, true, cancellation, backendId);
    assert.deepEqual(await gather(blobs.read(target, bytes.length, undefined, backendId)), bytes);
    await assert.rejects(
      blobs.duplicate(randomUUID(), randomUUID(), descriptor(bytes), cancellation, backendId),
      { code: 'unavailable' },
    );
  });
}
