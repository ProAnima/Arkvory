import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createServer, request } from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';
import { ArkvoryClient } from '@proanima/arkvory-sdk';
import { LocalBlobStore } from '@proanima/arkvory-infrastructure';
import { parseArguments } from '../../apps/cli/dist/arguments.js';
import { treeCommand } from '../../apps/cli/dist/tree/tree-command.js';
import { treeIndexer } from '../../apps/worker/dist/tree-loop.js';
import { removeTestDirectory } from '../helpers.mjs';
import { setup, base } from './fixture.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const running = { throwIfAborted() {} };

/**
 * A pass-through proxy in front of the API that counts the response bytes of content
 * downloads, as an operator would measure what a repair moves over the wire.
 */
async function countingProxy(t, origin) {
  const target = new URL(origin);
  const counted = { content: 0, ranges: [] };
  const proxy = createServer((req, res) => {
    const forward = request(
      {
        host: target.hostname,
        port: target.port,
        path: req.url,
        method: req.method,
        headers: req.headers,
      },
      (answer) => {
        res.writeHead(answer.statusCode ?? 502, answer.headers);
        const content = req.url.endsWith('/content');
        if (content) counted.ranges.push(req.headers.range);
        answer.on('data', (chunk) => {
          if (content) counted.content += chunk.length;
          res.write(chunk);
        });
        answer.on('end', () => res.end());
      },
    );
    req.pipe(forward);
  });
  proxy.listen(0, '127.0.0.1');
  await new Promise((resolve) => proxy.once('listening', resolve));
  t.after(() => new Promise((resolve) => (proxy.close(resolve), proxy.closeAllConnections())));
  return { url: `http://127.0.0.1:${proxy.address().port}`, counted };
}

async function fixture(t) {
  const cleanup = [];
  t.after(async () => {
    for (const close of cleanup.reverse()) await close();
  });
  const f = await setup({ after: (close) => cleanup.push(close) });
  const { indexer, close } = treeIndexer({
    catalog: f.catalog,
    blobs: new LocalBlobStore(f.directory, 0),
  });
  cleanup.push(close);
  const origin = await f.listen();
  const proxy = await countingProxy(t, origin);
  const token = f.headers.authorization.slice('Bearer '.length);
  const client = new ArkvoryClient(proxy.url, () => token, { baseDelayMs: 1, maxDelayMs: 5 });
  const repository = base.split('/').at(-1);
  const work = await mkdtemp(join(tmpdir(), 'arkvory-tree-it-'));
  t.after(() => removeTestDirectory(work));
  const run = (...words) =>
    treeCommand(
      parseArguments(['tree', ...words]),
      { client, server: proxy.url, repository },
      AbortSignal.timeout(60_000),
      () => undefined,
    );
  return { f, indexer, proxy, run, work };
}

async function listing(root) {
  const result = {};
  const walk = async (directory, prefix) => {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.isDirectory()) await walk(join(directory, item.name), path);
      else result[path] = sha(await readFile(join(directory, item.name)));
    }
  };
  await walk(root, '');
  return result;
}

test('push, pull, verify and repair a tree through the real API and worker', async (t) => {
  const { indexer, proxy, run, work } = await fixture(t);
  const source = join(work, 'build');
  await mkdir(join(source, 'data', 'deep'), { recursive: true });
  await writeFile(join(source, 'README.md'), '# build\n');
  await writeFile(join(source, 'data', 'deep', 'big.bin'), Buffer.alloc(3 * 1024 * 1024 + 11, 3));
  await writeFile(join(source, 'data', 'small.txt'), 'small file\n');
  await writeFile(join(source, 'data', 'empty'), '');
  const pushed = await run('push', source, '--label', 'tree-test');
  assert.equal(pushed.name, 'build.zip');
  assert.equal(pushed.entries, 4);
  // The archive and its checkpoint beside the folder are gone after success.
  assert.deepEqual((await readdir(work)).sort(), ['build']);
  // A second push of the unchanged folder gives the same bytes.
  const again = await run('push', source, '--name', 'build-again.zip');
  assert.equal(again.sha256, pushed.sha256);

  // Before the worker indexed it: the whole archive (T1).
  const copy = join(work, 'copy');
  assert.equal((await run('pull', pushed.id, copy)).mode, 'archive');
  assert.deepEqual(await listing(copy), await listing(source));
  assert.equal((await run('verify', pushed.id, copy)).json.mode, 'archive');

  const outcomes = await indexer.pass(running);
  assert.ok(outcomes.some((o) => o.id === pushed.id && o.kind === 'ready'));
  const verified = await run('verify', pushed.id, copy);
  assert.deepEqual([verified.json.mode, verified.json.ok], ['toc', true]);

  // One byte of the big file changed locally: repair moves only that entry's bytes.
  const big = join(copy, 'data', 'deep', 'big.bin');
  const bytes = await readFile(big);
  bytes[2 * 1024 * 1024] ^= 0x55;
  await writeFile(big, bytes);
  const found = await run('verify', pushed.id, copy);
  assert.deepEqual(found.json.mismatched, ['data/deep/big.bin']);
  proxy.counted.content = 0;
  proxy.counted.ranges.length = 0;
  const repaired = await run('repair', pushed.id, copy);
  assert.deepEqual([repaired.mode, repaired.repaired], ['toc', 1]);
  assert.equal(proxy.counted.content, bytes.length, 'only the stored entry, not the archive');
  assert.equal(repaired.fetchedBytes, String(bytes.length));
  assert.ok(proxy.counted.ranges.every((range) => /^bytes=\d+-\d+$/.test(range)));
  assert.deepEqual(await listing(copy), await listing(source));

  // pull into a folder with files: differing ones replaced, extra ones removed.
  await writeFile(join(copy, 'data', 'small.txt'), 'changed\n');
  await writeFile(join(copy, 'stray.log'), 'stray');
  const synced = await run('pull', pushed.id, copy);
  assert.deepEqual([synced.mode, synced.repaired, synced.removed], ['toc', 1, 1]);
  assert.deepEqual(await listing(copy), await listing(source));
});

/** A stored ZIP with arbitrary names, as a hostile client could publish. */
function rawZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
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
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
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

async function publish(f, name, bytes) {
  const made = await f.app.inject({
    method: 'POST',
    url: `${base}/uploads`,
    headers: { ...f.headers, 'idempotency-key': randomUUID() },
    payload: { name, size: String(bytes.length), sha256: sha(bytes), labels: [], metadata: {} },
  });
  assert.equal(made.statusCode, 201, made.body);
  const { id } = made.json();
  const done = await f.app.inject({
    method: 'PUT',
    url: `${base}/uploads/${id}/content`,
    headers: { ...f.headers, 'content-type': 'application/octet-stream' },
    payload: bytes,
  });
  assert.equal(done.statusCode, 200, done.body);
  return id;
}

test('archives that leave the folder or hold Windows device names are never extracted', async (t) => {
  const { f, indexer, run, work } = await fixture(t);
  const cases = [
    ['escape.zip', [{ name: '../escape.txt', data: Buffer.from('x') }], 'path_outside_root'],
    ['device.zip', [{ name: 'tools/aux.txt', data: Buffer.from('x') }], 'unsafe_name'],
  ];
  for (const [name, entries, code] of cases) {
    const id = await publish(f, name, rawZip(entries));
    await indexer.pass(running);
    const target = join(work, 'target');
    await assert.rejects(run('pull', id, target), { code }, code);
    await assert.rejects(stat(target));
    await assert.rejects(stat(join(work, 'escape.txt')));
  }
  // A folder with a name Windows cannot hold is refused before anything is uploaded. Such a
  // file can only be created where it is legal: on Windows the name opens the console device.
  if (process.platform !== 'win32') {
    const source = join(work, 'source');
    await mkdir(source);
    await writeFile(join(source, 'CON.txt'), 'x');
    await assert.rejects(run('push', source), { code: 'unsafe_name' });
  }
});
