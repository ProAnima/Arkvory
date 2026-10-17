import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buffer as streamBytes } from 'node:stream/consumers';
import yazl from 'yazl';
import { ArkvoryError } from '@proanima/arkvory-domain';
import {
  BlobRangeReader,
  LocalBlobStore,
  ZipManifestReader,
} from '@proanima/arkvory-infrastructure';
import { MemoryBlobStore, portOnly } from './memory-blobs.mjs';
import { layoutBytes, zip64Layout } from './zip64-archive.mjs';
import { removeTestDirectory } from './helpers.mjs';

const manifest = Buffer.from(JSON.stringify({ name: 'example', version: '1.2.3' }));

function read(reader, position, length) {
  return new Promise((resolve, reject) => {
    const target = Buffer.alloc(length);
    reader.read(target, 0, length, position, (error, bytesRead) => {
      if (error) reject(error);
      else resolve({ target, bytesRead });
    });
  });
}

function stored(bytes, backend = 'default') {
  const store = new MemoryBlobStore();
  const id = randomUUID();
  store.place(id, bytes, backend);
  return { store, blob: { id, size: bytes.length, storageBackend: backend } };
}

async function zipOf(entries, options = {}) {
  const zip = new yazl.ZipFile();
  for (const [name, bytes] of entries) zip.addBuffer(bytes, name, options);
  zip.end(options);
  return streamBytes(zip.outputStream);
}

/** A store whose read yields `chunks` and then whatever `after` does, for faults. */
function scripted(size, chunks, after = async () => undefined) {
  return {
    returned: 0,
    read() {
      const store = this;
      return {
        [Symbol.asyncIterator]() {
          let index = 0;
          return {
            async next() {
              if (index < chunks.length) return { done: false, value: chunks[index++] };
              await after();
              return { done: true, value: undefined };
            },
            async return() {
              store.returned++;
              return { done: true, value: undefined };
            },
          };
        },
      };
    },
    size,
  };
}

test('header reads come from one bounded window per range, at the exact boundaries', async () => {
  const bytes = randomBytes(300_000);
  const { store, blob } = stored(bytes, 'volume-2');
  const reader = new BlobRangeReader(store, blob, { windowBytes: 100_000 });
  // First and last byte, a read that ends exactly at the end, and the window reused.
  assert.deepEqual((await read(reader, 0, 1)).target, bytes.subarray(0, 1));
  assert.deepEqual((await read(reader, 99_999, 1)).target, bytes.subarray(99_999, 100_000));
  assert.equal(store.reads.length, 1);
  assert.deepEqual(store.reads[0], { id: blob.id, start: 0, end: 99_999, backendId: 'volume-2' });
  // Crossing the window's end fetches a new window starting at the read.
  const crossing = await read(reader, 99_990, 20);
  assert.deepEqual(crossing.target, bytes.subarray(99_990, 100_010));
  assert.equal(crossing.bytesRead, 20);
  assert.deepEqual(store.reads[1], {
    id: blob.id,
    start: 99_990,
    end: 199_989,
    backendId: 'volume-2',
  });
  // A window that would pass the end starts earlier and ends exactly at the last byte.
  const tail = await read(reader, 299_990, 10);
  assert.deepEqual(tail.target, bytes.subarray(299_990));
  assert.deepEqual(store.reads[2], {
    id: blob.id,
    start: 200_000,
    end: 299_999,
    backendId: 'volume-2',
  });
  assert.deepEqual((await read(reader, 250_000, 0)).target, Buffer.alloc(0));
  assert.equal(store.reads.length, 3);
  // Outside the blob, or longer than any ZIP header read: refused before the port.
  for (const [position, length] of [
    [299_999, 2],
    [-1, 1],
    [0, 300_000],
  ])
    await assert.rejects(read(reader, position, length), { code: 'invalid_input' });
  assert.equal(store.reads.length, 3);
});

test('short, long and failed ranges are typed failures, kept for the caller', async () => {
  const short = scripted(10, [Buffer.alloc(6)]);
  let reader = new BlobRangeReader(short, { id: randomUUID(), size: 10 });
  await assert.rejects(read(reader, 0, 10), { code: 'integrity_mismatch' });
  assert.equal(reader.failure.code, 'integrity_mismatch');
  const long = scripted(10, [Buffer.alloc(8), Buffer.alloc(8)]);
  reader = new BlobRangeReader(long, { id: randomUUID(), size: 10 });
  await assert.rejects(read(reader, 0, 10), { code: 'integrity_mismatch' });
  assert.equal(long.returned, 1, 'the port iterator is returned');
  const missing = new MemoryBlobStore();
  reader = new BlobRangeReader(missing, { id: randomUUID(), size: 10 });
  await assert.rejects(read(reader, 0, 10), { code: 'unavailable' });
  assert.equal(reader.failure.code, 'unavailable');
  // The first failure stays: later errors do not replace it.
  await assert.rejects(read(reader, 2, 2), { code: 'unavailable' });
  assert.ok(reader.failure instanceof ArkvoryError);
});

test('an abort ends a range the port has not answered and refuses later reads', async () => {
  const hanging = scripted(1000, [], () => new Promise(() => undefined));
  const controller = new AbortController();
  const reader = new BlobRangeReader(
    hanging,
    { id: randomUUID(), size: 1000 },
    {
      signal: controller.signal,
    },
  );
  const pending = read(reader, 0, 10);
  setTimeout(() => controller.abort(new ArkvoryError('unavailable', 'Stopped')), 20);
  await assert.rejects(pending, { message: 'Stopped' });
  assert.equal(reader.failure.message, 'Stopped');
  await assert.rejects(read(reader, 500, 10), { message: 'Stopped' });
  // A failing check (a lost content pin) stops the next range before the port.
  const { store, blob } = stored(randomBytes(100));
  const checked = new BlobRangeReader(store, blob, {
    check: () => {
      throw new ArkvoryError('unavailable', 'Content protection lost');
    },
  });
  await assert.rejects(read(checked, 0, 10), { message: 'Content protection lost' });
  assert.equal(store.reads.length, 0);
});

test('entry streams pull the range with backpressure and release it when destroyed', async () => {
  const bytes = randomBytes(4 * 1024 * 1024);
  const { store, blob } = stored(bytes);
  const reader = new BlobRangeReader(store, blob);
  const whole = await streamBytes(reader.createReadStream({ start: 1000, end: 700_000 }));
  assert.deepEqual(whole, bytes.subarray(1000, 700_000));
  let pulled = 0,
    released = 0;
  const counting = {
    read: (...args) => {
      const source = store.read(...args);
      return (async function* () {
        try {
          for await (const chunk of source) {
            pulled += chunk.length;
            yield chunk;
          }
        } finally {
          released++;
        }
      })();
    },
  };
  const stream = new BlobRangeReader(counting, blob).createReadStream({
    start: 0,
    end: bytes.length,
  });
  const first = await new Promise((resolve) => stream.once('data', resolve));
  stream.pause();
  await new Promise((resolve) => setTimeout(resolve, 20));
  // A paused consumer stops the reads after a few chunks instead of buffering the range.
  assert.ok(first.length > 0 && pulled <= 1024 * 1024, `pulled ${String(pulled)}`);
  assert.equal(released, 0);
  stream.destroy();
  // Destroying the stream returns the port's iterator, which closes its file or connection.
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(released, 1);
});

test('UPack manifests are parsed through the port, with the upload storage and small reads', async () => {
  const archive = await zipOf([
    ['upack.json', manifest],
    ['package/file.bin', randomBytes(200_000)],
  ]);
  const { store, blob } = stored(archive, 'volume-2');
  const parsed = await new ZipManifestReader(portOnly(store)).inspect(blob);
  assert.equal(parsed.name, 'example');
  assert.ok(store.reads.every((r) => r.backendId === 'volume-2'));
  // ZIP64 end records written by yazl are found as well.
  const zip64 = await zipOf([['upack.json', manifest]], { forceZip64Format: true });
  const forced = stored(zip64);
  assert.equal((await new ZipManifestReader(forced.store).inspect(forced.blob)).version, '1.2.3');
});

test('a ZIP64 archive over 4 GiB is parsed from a few small ranges past 4 GiB', async () => {
  const layout = zip64Layout([
    { name: 'package/big.bin', zeros: 5 * 1024 ** 3 },
    { name: 'package/tail.bin', data: Buffer.from('tail') },
    { name: 'upack.json', data: manifest },
  ]);
  assert.ok(layout.size > 2 ** 32);
  const store = new MemoryBlobStore();
  const id = randomUUID();
  store.placeVirtual(id, layout.size, (s, e) => layoutBytes(layout, s, e - 1));
  const parsed = await new ZipManifestReader(store).inspect({ id, size: layout.size });
  assert.equal(parsed.name, 'example');
  // Every range lies past 4 GiB: offsets come from the ZIP64 fields, not the 32-bit ones.
  assert.ok(
    store.reads.every((r) => r.start > 2 ** 32),
    'every range past 4 GiB',
  );
  assert.ok(store.readBytes() <= 2 * 1024 * 1024, `read ${String(store.readBytes())} bytes`);
});

test('storage failures keep their code; only defects of the archive are invalid_input', async () => {
  const archive = await zipOf([['upack.json', manifest]]);
  const missing = new MemoryBlobStore();
  await assert.rejects(
    new ZipManifestReader(missing).inspect({ id: randomUUID(), size: archive.length }),
    { code: 'unavailable' },
  );
  // A blob in another storage than the upload names is unavailable, not another archive.
  const elsewhere = stored(archive, 'volume-2');
  await assert.rejects(
    new ZipManifestReader(elsewhere.store).inspect({
      ...elsewhere.blob,
      storageBackend: 'default',
    }),
    { code: 'unavailable' },
  );
  for (const bytes of [
    randomBytes(4096),
    archive.subarray(0, archive.length - 10),
    await zipOf([['other.json', manifest]]),
    await zipOf([['upack.json', Buffer.from('{')]]),
  ]) {
    const { store, blob } = stored(bytes);
    await assert.rejects(new ZipManifestReader(store).inspect(blob), { code: 'invalid_input' });
  }
  // Symbolic links are refused through the port as they were through the file.
  const linked = zip64Layout([
    { name: 'upack.json', data: manifest },
    { name: 'package/link', data: Buffer.from('/etc/passwd'), mode: 0o120777 },
  ]);
  const { store, blob } = stored(layoutBytes(linked, 0, linked.size - 1));
  await assert.rejects(new ZipManifestReader(store).inspect(blob), { code: 'invalid_input' });
});

/**
 * A ZIP whose only entry, `upack.json`, is deflated as `padding` empty stored blocks and then
 * the manifest: tiny once inflated, but as long as the padding makes it (a zip bomb inverted).
 */
function paddedManifest(bytes, padding) {
  const name = Buffer.from('upack.json');
  const empty = Buffer.from([0, 0, 0, 0xff, 0xff]);
  const last = Buffer.from([1, 0, 0, 0, 0]);
  last.writeUInt16LE(bytes.length, 1);
  last.writeUInt16LE(~bytes.length & 0xffff, 3);
  const compressed = padding * empty.length + last.length + bytes.length;
  const header = (signature, size) => {
    const fields = Buffer.alloc(size);
    fields.writeUInt32LE(signature, 0);
    return fields;
  };
  const local = header(0x04034b50, 30);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(compressed, 18);
  local.writeUInt32LE(bytes.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = header(0x02014b50, 46);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(compressed, 20);
  central.writeUInt32LE(bytes.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(0o100644 * 65536, 38);
  const end = header(0x06054b50, 22);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(local.length + name.length + compressed, 16);
  const head = Buffer.concat([local, name]);
  const tail = Buffer.concat([last, bytes, central, name, end]);
  const tailStart = head.length + padding * empty.length;
  const byteAt = (i) =>
    i < head.length
      ? head[i]
      : i < tailStart
        ? empty[(i - head.length) % empty.length]
        : tail[i - tailStart];
  return {
    size: tailStart + tail.length,
    slice: (s, e) => Buffer.from(Array.from({ length: e - s }, (_, k) => byteAt(s + k))),
  };
}

test('a manifest entry longer than any deflated manifest is refused before its data', async () => {
  const store = new MemoryBlobStore();
  const small = paddedManifest(manifest, 10);
  const valid = randomUUID();
  store.placeVirtual(valid, small.size, small.slice);
  const parsed = await new ZipManifestReader(store).inspect({ id: valid, size: small.size });
  assert.equal(parsed.name, 'example');
  // 20 MB of compressed data that inflates to the same few bytes is not read through the port.
  const padded = paddedManifest(manifest, 4_000_000);
  const id = randomUUID();
  store.placeVirtual(id, padded.size, padded.slice);
  store.reads.length = 0;
  await assert.rejects(new ZipManifestReader(store).inspect({ id, size: padded.size }), {
    code: 'invalid_input',
  });
  assert.ok(store.readBytes() <= 2 * 1024 * 1024, `read ${String(store.readBytes())} bytes`);
});

test('a central directory of many entries is parsed in bounded event loop turns', async () => {
  const entries = [['upack.json', manifest]];
  for (let i = 0; i < 20_000; i++) entries.push([`package/f${String(i)}.bin`, Buffer.from('x')]);
  const { store, blob } = stored(await zipOf(entries, { compress: false }));
  let turns = 0;
  const ticker = setInterval(() => turns++, 0);
  try {
    assert.equal((await new ZipManifestReader(store).inspect(blob)).name, 'example');
  } finally {
    clearInterval(ticker);
  }
  // The parse yields to the event loop while it reads, and a few windows hold the directory.
  assert.ok(turns > 1, `timers ran ${String(turns)} times`);
  assert.ok(store.reads.length <= 8, `${String(store.reads.length)} range reads`);
});

test('a local store reads a missing blob as unavailable and checks emptiness for restore', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'arkvory-range-local-'));
  t.after(() => removeTestDirectory(directory));
  const blobs = new LocalBlobStore(join(directory, 'storage'));
  await blobs.requireEmpty();
  await blobs.initialize();
  await assert.rejects(blobs.requireEmpty(), { code: 'conflict' });
  const id = randomUUID();
  await assert.rejects(new ZipManifestReader(blobs).inspect({ id, size: 100 }), {
    code: 'unavailable',
  });
  const archive = await zipOf([['upack.json', manifest]]);
  await writeFile(join(directory, 'storage', 'blobs', id), archive);
  const parsed = await new ZipManifestReader(blobs).inspect({ id, size: archive.length });
  assert.equal(parsed.name, 'example');
});
