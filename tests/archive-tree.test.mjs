import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { buffer as streamBytes } from 'node:stream/consumers';
import yazl from 'yazl';
import { ArkvoryError, TREE_MAX_TOTAL_BYTES } from '@proanima/arkvory-domain';
import { ZipTreeBuilder } from '@proanima/arkvory-infrastructure';
import { MemoryBlobStore } from './memory-blobs.mjs';
import { layoutBytes, zip64Layout } from './zip64-archive.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const running = { throwIfAborted() {} };
/** Compressible, deterministic content without ZIP signatures in it. */
const text = (label, repeat = 2000) => Buffer.from(`${label}:`.repeat(repeat));

async function zipOf(entries, options = {}) {
  const zip = new yazl.ZipFile();
  for (const [name, bytes, entry = {}] of entries)
    if (bytes === null) zip.addEmptyDirectory(name);
    else zip.addBuffer(bytes, name, { ...options, ...entry });
  zip.end(options);
  return streamBytes(zip.outputStream);
}

/** Pins that record what the builder did with them. */
function recordingPins(check = () => undefined) {
  const pins = { acquired: [], released: 0 };
  pins.acquire = async (id) => {
    pins.acquired.push(id);
    return {
      check,
      release: async () => {
        pins.released++;
      },
    };
  };
  return pins;
}

async function build(bytes, { pins, cancellation = running, store } = {}) {
  const blobs = store ?? new MemoryBlobStore();
  const blob = { id: randomUUID(), repository: 'releases', size: bytes.length };
  blobs.place(blob.id, bytes, 'volume-2');
  const builder = new ZipTreeBuilder(blobs, pins);
  const tree = await builder.build({ ...blob, storageBackend: 'volume-2' }, cancellation);
  return { tree, blobs, blob };
}

const reasonOf = async (bytes) => {
  const { tree } = await build(bytes);
  assert.equal(tree.status, 'unavailable');
  return tree.reason;
};

/** Offsets of the central directory headers of an archive without signatures in its data. */
function centralHeaders(archive) {
  const found = [];
  for (let at = 0; at + 4 <= archive.length; at++)
    if (archive.readUInt32LE(at) === 0x02014b50) found.push(at);
  return found;
}

function patchName(archive, from, to) {
  assert.equal(Buffer.byteLength(from), Buffer.byteLength(to));
  const source = Buffer.from(from);
  const patched = Buffer.from(archive);
  let at = patched.indexOf(source);
  assert.ok(at >= 0);
  while (at >= 0) {
    Buffer.from(to).copy(patched, at);
    at = patched.indexOf(source, at + 1);
  }
  return patched;
}

test('file entries get their size, SHA-256, method and exact data range; directories are skipped', async () => {
  const files = [
    ['docs/readme.txt', text('readme'), { compress: false }],
    ['docs/', null],
    ['bin/tool.bin', text('tool', 5000), { compress: true }],
    ['empty.txt', Buffer.alloc(0), { compress: false }],
    ['Ünïcode/файл.txt', text('unicode', 10), { compress: true }],
  ];
  const archive = await zipOf(files);
  const pins = recordingPins();
  const { tree, blobs, blob } = await build(archive, { pins });
  assert.equal(tree.status, 'ready');
  const expected = files.filter(([, bytes]) => bytes !== null);
  assert.deepEqual(
    tree.entries.map((e) => [e.ordinal, e.path, e.size, e.sha256, e.method]),
    expected.map(([name, bytes, entry], ordinal) => [
      ordinal,
      name,
      bytes.length,
      sha(bytes),
      entry.compress ? 'deflate' : 'stored',
    ]),
  );
  for (const [index, entry] of tree.entries.entries()) {
    const data = archive.subarray(entry.dataOffset, entry.dataOffset + entry.dataLength);
    const content = entry.method === 'stored' ? data : inflateRawSync(data);
    assert.deepEqual(content, expected[index][1], entry.path);
    if (entry.method === 'stored') assert.equal(entry.dataLength, entry.size);
    else assert.ok(entry.dataLength < entry.size, 'deflate data is the compressed size');
  }
  // Every byte came through the port from the upload's storage, under one released pin.
  assert.ok(blobs.reads.length > 0);
  assert.ok(blobs.reads.every((read) => read.id === blob.id && read.backendId === 'volume-2'));
  assert.deepEqual(pins.acquired, [blob.id]);
  assert.equal(pins.released, 1);
});

test('ZIP64 archives and archives without files are indexed', async () => {
  const bytes = text('zip64');
  const forced = await zipOf(
    [
      ['a.txt', bytes, { compress: false }],
      ['b.txt', bytes, { compress: true }],
    ],
    { forceZip64Format: true },
  );
  const { tree } = await build(forced);
  assert.equal(tree.status, 'ready');
  assert.deepEqual(
    tree.entries.map((e) => [e.path, e.sha256]),
    [
      ['a.txt', sha(bytes)],
      ['b.txt', sha(bytes)],
    ],
  );
  const stored = tree.entries[0];
  assert.deepEqual(
    forced.subarray(stored.dataOffset, stored.dataOffset + stored.dataLength),
    bytes,
  );
  const onlyDirectories = await build(
    await zipOf([
      ['a/', null],
      ['a/b/', null],
    ]),
  );
  assert.deepEqual(onlyDirectories.tree, { status: 'ready', entries: [] });
});

test('what is not a ZIP, or a broken one, is unavailable with its reason', async () => {
  assert.equal(await reasonOf(Buffer.alloc(0)), 'not_archive');
  assert.equal(await reasonOf(text('not a zip', 100)), 'not_archive');
  const archive = await zipOf([['a.txt', text('a'), { compress: true }]]);
  // A truncated central directory, and an inflated size that differs from the directory's.
  assert.equal(await reasonOf(archive.subarray(0, archive.length - 30)), 'not_archive');
  const [header] = centralHeaders(archive);
  const larger = Buffer.from(archive);
  larger.writeUInt32LE(larger.readUInt32LE(header + 24) + 1, header + 24);
  assert.equal(await reasonOf(larger), 'invalid_archive');
  const broken = Buffer.from(archive);
  broken.writeUInt32LE(0x99999999, broken.readUInt32LE(header + 42));
  assert.equal(await reasonOf(broken), 'invalid_archive');
});

test('links, special files, unsafe paths and encrypted entries are refused', async () => {
  const link = await zipOf([['link', Buffer.from('target'), { mode: 0o120777 }]]);
  assert.equal(await reasonOf(link), 'unsafe_entry');
  const fifo = await zipOf([['pipe', Buffer.alloc(0), { mode: 0o010644 }]]);
  assert.equal(await reasonOf(fifo), 'unsafe_entry');
  const plain = await zipOf([['xx/a.txt', text('a'), { compress: false }]]);
  assert.equal(await reasonOf(patchName(plain, 'xx/a.txt', '../a.txt')), 'unsafe_entry');
  assert.equal(await reasonOf(patchName(plain, 'xx/a.txt', '/x/a.txt')), 'unsafe_entry');
  assert.equal(await reasonOf(patchName(plain, 'xx/a.txt', 'C:/a.txt')), 'unsafe_entry');
  assert.equal(await reasonOf(patchName(plain, 'xx/a.txt', 'xx\\a.txt')), 'unsafe_entry');
  assert.equal(await reasonOf(patchName(plain, 'xx/a.txt', 'xx//.txt')), 'unsafe_entry');
  assert.equal(await reasonOf(patchName(plain, 'xx/a.txt', 'xx/\u0001.txt')), 'unsafe_entry');
  // Traditional encryption flag on a deflate entry (a stored one fails the size check first).
  const deflated = await zipOf([['a.txt', text('a'), { compress: true }]]);
  const [header] = centralHeaders(deflated);
  const encrypted = Buffer.from(deflated);
  encrypted.writeUInt16LE(encrypted.readUInt16LE(header + 8) | 1, header + 8);
  assert.equal(await reasonOf(encrypted), 'encrypted_entry');
});

test('the same path twice is refused, also when it differs only in case or normalization', async () => {
  const same = [
    ['a.txt', 'a.txt'],
    ['Docs/Read.me', 'docs/read.ME'],
    ['caf\u00e9.txt', 'cafe\u0301.txt'],
    ['dir/', 'DIR/'],
    // Upper case of the long s and the dotless i is S and I: one name on Windows.
    ['ſ.txt', 's.txt'],
    ['ıd', 'Id'],
  ];
  for (const [first, second] of same) {
    const entries = [first, second].map((name) =>
      name.endsWith('/') ? [name, null] : [name, text(name, 10)],
    );
    assert.equal(await reasonOf(await zipOf(entries)), 'duplicate_entry', `${first} ${second}`);
  }
});

test('a CRC-32 mismatch and an unsupported method are refused', async () => {
  for (const compress of [false, true]) {
    const archive = await zipOf([['a.txt', text('a'), { compress }]]);
    const [header] = centralHeaders(archive);
    const wrong = Buffer.from(archive);
    wrong.writeUInt32LE((wrong.readUInt32LE(header + 16) ^ 1) >>> 0, header + 16);
    assert.equal(await reasonOf(wrong), 'crc_mismatch');
  }
  const archive = await zipOf([['a.txt', text('a'), { compress: true }]]);
  const [header] = centralHeaders(archive);
  const bzip2 = Buffer.from(archive);
  bzip2.writeUInt16LE(12, header + 10);
  assert.equal(await reasonOf(bzip2), 'unsupported_method');
});

test('entries that share data are refused, whatever order the directory lists them in', async () => {
  // Every central header points at the first local header: one range hashed many times, the
  // amplification of an overlapping ZIP bomb.
  const archive = await zipOf([
    ['a.txt', text('same')],
    ['b.txt', text('same')],
    ['c.txt', text('same')],
  ]);
  const shared = Buffer.from(archive);
  for (const header of centralHeaders(shared).slice(1)) shared.writeUInt32LE(0, header + 42);
  assert.equal(await reasonOf(shared), 'invalid_archive');
  // The directory listing the entries in another order than their data is still an archive.
  const headers = centralHeaders(archive);
  const end = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const records = headers.map((at, index) => archive.subarray(at, headers[index + 1] ?? end));
  const reversed = Buffer.concat([
    archive.subarray(0, headers[0]),
    ...records.reverse(),
    archive.subarray(end),
  ]);
  const { tree } = await build(reversed);
  assert.deepEqual(
    tree.entries.map((entry) => entry.path),
    ['c.txt', 'b.txt', 'a.txt'],
  );
});

test('more entries or more content than the limits are refused before reading content', async () => {
  // The ZIP64 end record declares the entry count; the parse stops at the count.
  const archive = await zipOf([['a.txt', text('a')]], { forceZip64Format: true });
  const record = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x06, 0x06]));
  const many = Buffer.from(archive);
  many.writeBigUInt64LE(100_001n, record + 24);
  many.writeBigUInt64LE(100_001n, record + 32);
  assert.equal(await reasonOf(many), 'too_many_entries');
  // An entry larger than all content allowed, described without being written.
  const layout = zip64Layout([{ name: 'huge.bin', zeros: TREE_MAX_TOTAL_BYTES + 1 }]);
  const blobs = new MemoryBlobStore();
  const id = randomUUID();
  blobs.placeVirtual(id, layout.size, (start, end) => layoutBytes(layout, start, end - 1));
  const tree = await new ZipTreeBuilder(blobs).build(
    { id, repository: 'releases', size: layout.size },
    running,
  );
  assert.deepEqual(tree, { status: 'unavailable', reason: 'too_large' });
  assert.ok(blobs.readBytes() < 4 * 1024 * 1024, 'only headers were read');
});

test('storage failures, a lost pin and a stop are thrown, never recorded as a defect', async () => {
  const archive = await zipOf([['a.txt', text('a', 50_000), { compress: false }]]);
  // The blob is not in the named storage: the port's own code.
  const missing = new MemoryBlobStore();
  const builder = new ZipTreeBuilder(missing);
  await assert.rejects(
    builder.build({ id: randomUUID(), repository: 'releases', size: archive.length }, running),
    { code: 'unavailable' },
  );
  // Content that ends inside an entry (the storage lost bytes) is a storage failure: the first
  // range is the header window, the second the entry's data, cut short here.
  const inner = new MemoryBlobStore();
  const id = randomUUID();
  inner.place(id, archive);
  let ranges = 0;
  const failing = {
    async *read(...args) {
      ranges++;
      for await (const chunk of inner.read(...args)) {
        yield ranges > 1 ? chunk.subarray(0, 10) : chunk;
        if (ranges > 1) return;
      }
    },
  };
  await assert.rejects(
    new ZipTreeBuilder(failing).build(
      { id, repository: 'releases', size: archive.length },
      running,
    ),
    { code: 'integrity_mismatch' },
  );
  assert.equal(ranges, 2);
  const lost = recordingPins(() => {
    throw new ArkvoryError('unavailable', 'Content protection lost');
  });
  await assert.rejects(build(archive, { pins: lost }), { message: 'Content protection lost' });
  assert.equal(lost.released, 1);
  let reads = 0;
  const stopping = {
    throwIfAborted() {
      if (++reads > 3) throw new ArkvoryError('unavailable', 'Stopped');
    },
  };
  await assert.rejects(build(archive, { cancellation: stopping }), { message: 'Stopped' });
});
