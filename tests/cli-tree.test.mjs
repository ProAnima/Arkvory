import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { chmod, mkdir, mkdtemp, open, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';
import { ArkvoryClient } from '@proanima/arkvory-sdk';
import { parseArguments } from '../apps/cli/dist/arguments.js';
import { treeCommand } from '../apps/cli/dist/tree/tree-command.js';
import { treeFiles, writeTreeArchive } from '../apps/cli/dist/tree/zip-write.js';
import { archiveEntries, dataOffset } from '../apps/cli/dist/tree/zip-read.js';
import { TreeNames, treePath } from '../apps/cli/dist/tree/tree-paths.js';
import { removeTestDirectory } from './helpers.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const signal = () => AbortSignal.timeout(30_000);

async function temporary(t) {
  const directory = await mkdtemp(join(tmpdir(), 'arkvory-tree-'));
  t.after(() => removeTestDirectory(directory));
  return directory;
}

/** A small tree: nested files, an empty file, an executable script, a file of 300 KiB. */
async function sampleTree(root) {
  await mkdir(join(root, 'bin'), { recursive: true });
  await mkdir(join(root, 'data', 'deep'), { recursive: true });
  await writeFile(join(root, 'README.md'), '# sample\n');
  await writeFile(join(root, 'bin', 'run.sh'), '#!/bin/sh\necho run\n');
  await chmod(join(root, 'bin', 'run.sh'), 0o755);
  await writeFile(join(root, 'data', 'empty.txt'), '');
  await writeFile(join(root, 'data', 'deep', 'blob.bin'), Buffer.alloc(300 * 1024, 7));
}

async function pack(t, compress = false) {
  const work = await temporary(t);
  const root = join(work, 'tree');
  await mkdir(root);
  await sampleTree(root);
  const archive = join(work, 'tree.zip');
  await writeTreeArchive(await treeFiles(root, signal()), archive, compress, signal());
  return { work, root, archive, bytes: await readFile(archive) };
}

/** The table of contents the server would build, from the archive itself. */
async function tableOf(archive) {
  const handle = await open(archive, 'r');
  try {
    const bytes = await readFile(archive);
    const entries = await archiveEntries(handle, bytes.length);
    return Promise.all(
      entries.map(async (entry, ordinal) => {
        const offset = await dataOffset(handle, entry);
        const data = bytes.subarray(offset, offset + entry.compressedSize);
        const content =
          entry.method === 8 ? (await import('node:zlib')).inflateRawSync(data) : data;
        return {
          ordinal,
          path: entry.path,
          size: String(entry.size),
          sha256: sha256(content),
          method: entry.method === 8 ? 'deflate' : 'stored',
          dataOffset: String(offset),
          dataLength: String(entry.compressedSize),
        };
      }),
    );
  } finally {
    await handle.close();
  }
}

/**
 * A server with one archive artifact `a1`: metadata, content ranges (`served` may differ from
 * the published bytes) and its table of contents (`table` null: still pending).
 */
async function serve(t, bytes, { table, served = bytes } = {}) {
  const ranges = [];
  const meta = {
    id: 'a1',
    repository: 'releases',
    status: 'available',
    createdAt: '2026-10-18T00:00:00Z',
    expiresAt: '2026-10-19T00:00:00Z',
    descriptor: {
      name: 'tree.zip',
      size: String(bytes.length),
      sha256: sha256(bytes),
      labels: [],
      metadata: {},
    },
  };
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.endsWith('/tree')) {
      if (table === null)
        return res.end(
          JSON.stringify({
            status: 'pending',
            reason: null,
            archiveSha256: meta.descriptor.sha256,
            entries: null,
            items: [],
            next: null,
          }),
        );
      const after = Number(url.searchParams.get('after') ?? -1);
      const items = table.filter((item) => item.ordinal > after).slice(0, 2);
      const next =
        items.length && items.at(-1).ordinal < table.length - 1
          ? String(items.at(-1).ordinal)
          : null;
      return res.end(
        JSON.stringify({
          status: 'ready',
          reason: null,
          archiveSha256: meta.descriptor.sha256,
          entries: table.length,
          items,
          next,
        }),
      );
    }
    if (url.pathname.endsWith('/content')) {
      const [, start, end] = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range).map(Number);
      ranges.push([start, end]);
      res.writeHead(206, {
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${bytes.length}`,
        ETag: `"sha256:${meta.descriptor.sha256}"`,
      });
      return res.end(served.subarray(start, end + 1));
    }
    return res.end(JSON.stringify(meta));
  });
  server.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => (server.close(resolve), server.closeAllConnections())));
  const client = new ArkvoryClient(`http://127.0.0.1:${server.address().port}`, () => 'token', {
    baseDelayMs: 1,
    maxDelayMs: 5,
    maxAttempts: 2,
  });
  return { connected: { client, server: 'test', repository: 'releases' }, ranges };
}

const run = (connected, ...words) =>
  treeCommand(parseArguments(['tree', ...words]), connected, signal(), () => undefined);

async function listing(root) {
  const result = {};
  const walk = async (directory, prefix) => {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.isDirectory()) await walk(join(directory, item.name), path);
      else result[path] = sha256(await readFile(join(directory, item.name)));
    }
  };
  await walk(root, '');
  return result;
}

test('one directory state always packs into the same archive bytes', async (t) => {
  const first = await pack(t);
  const again = join(first.work, 'again.zip');
  await writeTreeArchive(await treeFiles(first.root, signal()), again, false, signal());
  assert.deepEqual(await readFile(again), first.bytes);
  const table = await tableOf(first.archive);
  assert.deepEqual(
    table.map((entry) => entry.path),
    ['README.md', 'bin/run.sh', 'data/deep/blob.bin', 'data/empty.txt'],
  );
  // Stored entries: the data range of an entry is exactly the file.
  const blob = table[2];
  const range = first.bytes.subarray(
    Number(blob.dataOffset),
    Number(blob.dataOffset) + Number(blob.dataLength),
  );
  assert.deepEqual(range, await readFile(join(first.root, 'data/deep/blob.bin')));
  const compressed = await pack(t, true);
  assert.ok(compressed.bytes.length < first.bytes.length);
  assert.equal((await tableOf(compressed.archive))[2].method, 'deflate');
});

test('tree paths stay inside the root and mean the same on Windows', () => {
  for (const path of ['../x', 'a/../../x', '/etc/passwd', 'C:/x', 'a:b', 'a\\b', 'a//b', './a'])
    assert.throws(() => treePath(path), { code: 'path_outside_root' }, path);
  for (const path of ['aux.txt', 'dir/CON', 'x/a:b', 'what?', 'trailing.', 'space ', 'lpt1.log'])
    assert.throws(() => treePath(path), { code: 'unsafe_name' }, path);
  const names = new TreeNames();
  names.add('Docs/readme.md');
  assert.throws(() => names.add('docs/other.md'), { code: 'case_collision' });
  assert.throws(() => names.add('Docs/README.md'), { code: 'case_collision' });
  assert.throws(() => names.add('Docs/readme.md'), { code: 'duplicate_entry' });
  assert.throws(() => names.add('Docs/readme.md/inner'), { code: 'case_collision' });
});

test('pull, verify and repair with the table of contents fetch only what differs', async (t) => {
  const { work, root, archive, bytes } = await pack(t);
  const table = await tableOf(archive);
  const { connected, ranges } = await serve(t, bytes, { table });
  const target = join(work, 'copy');
  // An empty target takes the whole archive.
  const pulled = await run(connected, 'pull', 'a1', target);
  assert.equal(pulled.mode, 'archive');
  assert.deepEqual(await listing(target), await listing(root));
  if (process.platform !== 'win32')
    assert.equal((await stat(join(target, 'bin/run.sh'))).mode & 0o777, 0o755);
  assert.equal((await run(connected, 'verify', 'a1', target)).json.ok, true);
  // One byte changed in place, one file removed, one extra file.
  const blob = join(target, 'data/deep/blob.bin');
  const changed = await readFile(blob);
  changed[1000] ^= 0xff;
  await writeFile(blob, changed);
  await writeFile(join(target, 'README.md'), '# sample\n'.replace('s', 'S'));
  await (await import('node:fs/promises')).unlink(join(target, 'data/empty.txt'));
  await writeFile(join(target, 'notes.txt'), 'local');
  const verified = await run(connected, 'verify', 'a1', target);
  assert.equal(verified.exitCode, 5);
  assert.deepEqual(verified.json.mismatched, ['README.md', 'data/deep/blob.bin']);
  assert.deepEqual(verified.json.missing, ['data/empty.txt']);
  assert.deepEqual(verified.json.extra, ['notes.txt']);
  ranges.length = 0;
  const repaired = await run(connected, 'repair', 'a1', target);
  assert.equal(repaired.mode, 'toc');
  assert.equal(repaired.repaired, 3);
  // Only the two changed entries' data ranges; the empty file needs none.
  const want = [table[0], table[2]].map((e) => [
    Number(e.dataOffset),
    Number(e.dataOffset) + Number(e.dataLength) - 1,
  ]);
  const covered = ranges.reduce((sum, [s, e]) => sum + e - s + 1, 0);
  assert.equal(covered, Number(table[0].dataLength) + Number(table[2].dataLength));
  assert.ok(ranges.every(([s, e]) => want.some(([ws, we]) => s >= ws && e <= we)));
  assert.equal(repaired.fetchedBytes, String(covered));
  assert.equal(await readFile(join(target, 'notes.txt'), 'utf8'), 'local');
  assert.equal((await run(connected, 'verify', 'a1', target)).json.ok, true);
  // pull into a directory with files makes it the tree: the extra file goes.
  const synced = await run(connected, 'pull', 'a1', target);
  assert.deepEqual([synced.mode, synced.removed], ['toc', 1]);
  assert.deepEqual(await listing(target), await listing(root));
});

test('without a table of contents verify and repair use the whole verified archive', async (t) => {
  const { work, root, bytes } = await pack(t, true);
  const { connected, ranges } = await serve(t, bytes, { table: null });
  const target = join(work, 'copy');
  await run(connected, 'pull', 'a1', target);
  await writeFile(join(target, 'bin/run.sh'), 'echo changed\n');
  const verified = await run(connected, 'verify', 'a1', target);
  assert.deepEqual([verified.json.mode, verified.json.mismatched], ['archive', ['bin/run.sh']]);
  const repaired = await run(connected, 'repair', 'a1', target);
  assert.deepEqual([repaired.mode, repaired.repaired], ['archive', 1]);
  assert.deepEqual(await listing(target), await listing(root));
  assert.ok(ranges.length >= 3);
  assert.deepEqual((await readdir(work)).sort(), ['copy', 'tree', 'tree.zip']);
});

test('a substituted byte on the server never reaches the local tree', async (t) => {
  const { work, archive, bytes } = await pack(t);
  const table = await tableOf(archive);
  const target = join(work, 'copy');
  await run((await serve(t, bytes, { table })).connected, 'pull', 'a1', target);
  const before = await listing(target);
  await writeFile(join(target, 'data/deep/blob.bin'), Buffer.alloc(300 * 1024, 9));
  const forged = Buffer.from(bytes);
  forged[Number(table[2].dataOffset) + 5] ^= 1;
  // The server's bytes differ from the table of contents: the writer refuses the file.
  const { connected } = await serve(t, bytes, { table, served: forged });
  await assert.rejects(run(connected, 'repair', 'a1', target), { code: 'checksum_mismatch' });
  assert.deepEqual((await readFile(join(target, 'data/deep/blob.bin')))[0], 9);
  assert.deepEqual(await readdir(join(target, 'data/deep')), ['blob.bin']);
  // Without a table the whole archive fails its SHA-256 and nothing is extracted.
  const whole = await serve(t, bytes, { table: null, served: forged });
  const fresh = join(work, 'fresh');
  await assert.rejects(
    run(whole.connected, 'pull', 'a1', fresh),
    (error) => error.name === 'ArkvoryIntegrityError',
  );
  await assert.rejects(stat(fresh));
  assert.notDeepEqual(before, {});
});

/** A stored ZIP with arbitrary names, as a hostile archive would have. */
function rawZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data, mode = 0o100644 } of entries) {
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE((mode << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

test('hostile archives and tables of contents never write outside the target', async (t) => {
  const work = await temporary(t);
  const cases = [
    [[{ name: '../escape.txt', data: Buffer.from('x') }], 'path_outside_root'],
    [[{ name: 'ok/../../escape.txt', data: Buffer.from('x') }], 'path_outside_root'],
    [[{ name: '/abs.txt', data: Buffer.from('x') }], 'path_outside_root'],
    [[{ name: 'aux.txt', data: Buffer.from('x') }], 'unsafe_name'],
    [[{ name: 'a.txt:stream', data: Buffer.from('x') }], 'unsafe_name'],
    [[{ name: 'link', data: Buffer.from('/etc/passwd'), mode: 0o120777 }], 'unsupported_entry'],
    [
      [
        { name: 'A.txt', data: Buffer.from('1') },
        { name: 'a.txt', data: Buffer.from('2') },
      ],
      'case_collision',
    ],
  ];
  for (const [entries, code] of cases) {
    const bytes = rawZip(entries);
    const { connected } = await serve(t, bytes, { table: null });
    const target = join(work, 'target');
    await assert.rejects(run(connected, 'pull', 'a1', target), { code }, code);
    assert.deepEqual(
      (await readdir(work)).filter((name) => !name.startsWith('.')),
      [],
    );
  }
  // A table of contents from a hostile server is checked by the same rules.
  const { bytes } = await pack(t);
  const table = [
    {
      ordinal: 0,
      path: '../../escape.txt',
      size: '1',
      sha256: sha256(Buffer.from('x')),
      method: 'stored',
      dataOffset: '0',
      dataLength: '1',
    },
  ];
  const { connected } = await serve(t, bytes, { table });
  const target = join(work, 'kept');
  await mkdir(target);
  await writeFile(join(target, 'file.txt'), 'local');
  await assert.rejects(run(connected, 'repair', 'a1', target), { code: 'path_outside_root' });
  await assert.rejects(stat(join(work, 'escape.txt')));
});
