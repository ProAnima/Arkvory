import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { buffer as streamBytes } from 'node:stream/consumers';
import { setTimeout as delay } from 'node:timers/promises';
import yazl from 'yazl';
import { ArkvoryError } from '@proanima/arkvory-domain';
import {
  LocalBlobStore,
  PostgresCleanup,
  PostgresTreeIndexes,
} from '@proanima/arkvory-infrastructure';
import { createServer } from '../../apps/api/dist/index.js';
import { runTreeIndexing, treeIndexer } from '../../apps/worker/dist/tree-loop.js';
import { validateResponse } from '../api-schema.mjs';
import { setup, base } from './fixture.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const treePath = '/api/v1/repositories/{repository}/artifacts/{id}/tree';
const running = { throwIfAborted() {} };
const policy = { slots: 2, slot: 0, bytesPerSecond: 1 << 20, perPrincipalBytesPerSecond: 1 << 20 };

const files = [
  ['site/index.html', Buffer.from('<h1>index</h1>\n'.repeat(400)), false],
  ['site/app.js', Buffer.from('console.log(1);\n'.repeat(900)), true],
  ['site/empty.txt', Buffer.alloc(0), false],
  ['site/assets/logo.svg', Buffer.from('<svg/>\n'.repeat(700)), true],
  ['README.md', Buffer.from('# readme\n'.repeat(50)), false],
];

async function archive() {
  const zip = new yazl.ZipFile();
  zip.addEmptyDirectory('site/');
  for (const [name, bytes, compress] of files) zip.addBuffer(bytes, name, { compress });
  zip.end();
  return streamBytes(zip.outputStream);
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

async function tree(app, id, headers, query = '') {
  const response = await app.inject({ url: `${base}/artifacts/${id}/tree${query}`, headers });
  validateResponse(treePath, 'get', response);
  return response;
}

async function fixture(t) {
  const cleanup = [];
  t.after(async () => {
    for (const close of cleanup.reverse()) await close();
  });
  const f = await setup({ after: (close) => cleanup.push(close) }, { sharedDownloads: policy });
  const { indexer, close } = treeIndexer({
    catalog: f.catalog,
    blobs: new LocalBlobStore(f.directory, 0),
  });
  cleanup.push(close);
  return { f, indexer, cleanup };
}

test('the worker indexes published archives and the route pages through their entries', async (t) => {
  const { f, indexer, cleanup } = await fixture(t);
  const zip = await archive();
  const site = await publish(f, 'site.ZIP', zip);
  const tool = await publish(f, 'tool.bin', Buffer.from('not an archive'));
  const broken = await publish(f, 'broken.upack', Buffer.from('not an archive either'));
  const pending = await tree(f.app, site, f.headers);
  assert.deepEqual(pending.json(), {
    status: 'pending',
    reason: null,
    archiveSha256: sha(zip),
    entries: null,
    items: [],
    next: null,
  });
  const binary = (await tree(f.app, tool, f.headers)).json();
  assert.deepEqual([binary.status, binary.reason], ['unavailable', 'not_archive']);

  const reported = [];
  const outcomes = await indexer.pass(running, (outcome) => reported.push(outcome));
  assert.deepEqual(outcomes, reported);
  assert.deepEqual(
    outcomes.map((o) => [o.id, o.kind, o.entries ?? o.reason]).sort(),
    [
      [site, 'ready', files.length],
      [broken, 'unavailable', 'not_archive'],
    ].sort(),
  );
  assert.deepEqual(await indexer.pass(running), [], 'nothing is indexed twice');
  const refused = (await tree(f.app, broken, f.headers)).json();
  assert.deepEqual(
    [refused.status, refused.reason, refused.entries],
    ['unavailable', 'not_archive', null],
  );

  // Pages of two follow the cursor; every data range is the entry's data in the archive.
  const items = [];
  let after = '';
  for (let page = 0; page < 10; page++) {
    const body = (await tree(f.app, site, f.headers, `?limit=2${after}`)).json();
    assert.equal(body.status, 'ready');
    assert.equal(body.entries, files.length);
    assert.equal(body.archiveSha256, sha(zip));
    items.push(...body.items);
    if (body.next === null) break;
    assert.equal(body.next, String(body.items.at(-1).ordinal));
    after = `&after=${body.next}`;
  }
  assert.deepEqual(
    items.map((e) => [e.ordinal, e.path, e.size, e.sha256, e.method]),
    files.map(([name, bytes, compress], ordinal) => [
      ordinal,
      name,
      String(bytes.length),
      sha(bytes),
      compress ? 'deflate' : 'stored',
    ]),
  );
  for (const [index, entry] of items.entries()) {
    if (entry.dataLength === '0') continue;
    const end = Number(entry.dataOffset) + Number(entry.dataLength) - 1;
    const ranged = await f.app.inject({
      url: `${base}/artifacts/${site}/content`,
      headers: { ...f.headers, range: `bytes=${entry.dataOffset}-${String(end)}` },
    });
    assert.equal(ranged.statusCode, 206);
    const data = ranged.rawPayload;
    assert.deepEqual(entry.method === 'stored' ? data : inflateRawSync(data), files[index][1]);
  }
  const whole = (await tree(f.app, site, f.headers)).json();
  assert.deepEqual([whole.items.length, whole.next], [files.length, null]);

  // A read gateway serves the same table.
  const reader = await createServer({
    ...f.config,
    role: 'reader',
    sharedDownloads: { ...policy, slot: 1 },
  });
  cleanup.push(() => reader.close());
  const fromReader = await tree(reader, site, f.readerHeaders, '?after=1&limit=1');
  assert.deepEqual(fromReader.json().items, [items[2]]);
  assert.equal(fromReader.json().next, '2');
  const capabilities = await reader.inject({ url: '/api/v1/capabilities', headers: f.headers });
  validateResponse('/api/v1/capabilities', 'get', capabilities);
  assert.deepEqual(capabilities.json().tree, [
    { name: 'zip-tree', versions: ['1.0.0'], module: 'core', prefix: '/api/v1/' },
  ]);
});

test('the route reveals no more than the content download and refuses malformed pages', async (t) => {
  const { f, indexer } = await fixture(t);
  const site = await publish(f, 'site.zip', await archive());
  await indexer.pass(running);
  for (const query of ['?after=-1', '?after=01', '?after=x', '?limit=0', '?limit=1001', '?page=1'])
    assert.deepEqual([(await tree(f.app, site, f.headers, query)).statusCode, query], [400, query]);
  const invalid = await tree(f.app, site, f.headers, '?limit=0');
  assert.deepEqual([invalid.json().code, invalid.json().reason], ['invalid_input', 'validation']);
  const same = async (url, headers = f.headers) => {
    const [content, table] = await Promise.all(
      [`${url}/content`, `${url}/tree`].map((path) => f.app.inject({ url: path, headers })),
    );
    assert.deepEqual(
      [table.statusCode, table.json().code],
      [content.statusCode, content.json().code],
      url,
    );
    return table;
  };
  assert.equal((await same(`${base}/artifacts/${randomUUID()}`)).statusCode, 404);
  const foreign = `/api/v1/repositories/elsewhere/artifacts/${site}`;
  assert.equal((await same(foreign, f.readerHeaders)).statusCode, 403);
  assert.equal((await same(foreign)).statusCode, 403);
  const anonymous = await f.app.inject({ url: `${base}/artifacts/${site}/tree` });
  assert.equal(anonymous.statusCode, 401);

  // A deleted archive is gone from the route; reclaiming its content drops its table.
  await f.catalog.pool.query(
    "UPDATE arkvory_uploads SET status='cancelled',cancelled_at=now() WHERE id=$1",
    [site],
  );
  assert.equal((await same(`${base}/artifacts/${site}`)).statusCode, 404);
  const rows = async () =>
    (
      await f.catalog.pool.query(
        `SELECT (SELECT count(*) FROM arkvory_tree_indexes WHERE upload_id=$1)::int AS indexes,
        (SELECT count(*) FROM arkvory_tree_entries WHERE upload_id=$1)::int AS entries`,
        [site],
      )
    ).rows[0];
  assert.deepEqual(await rows(), { indexes: 1, entries: files.length });
  await new PostgresCleanup(f.catalog.pool).reclaimed(site);
  assert.deepEqual(await rows(), { indexes: 0, entries: 0 });
});

test('a racing second store of the same archive writes nothing', async (t) => {
  const { f, indexer } = await fixture(t);
  const site = await publish(f, 'site.zip', await archive());
  const store = new PostgresTreeIndexes(f.catalog.pool);
  const tree = { status: 'unavailable', reason: 'invalid_archive' };
  const saved = await Promise.all([store.save(site, tree), store.save(site, tree)]);
  assert.deepEqual(saved.sort(), [false, true]);
  // The stored outcome stays; the worker does not take the archive again.
  assert.deepEqual(await indexer.pass(running), []);
  assert.deepEqual(await store.state(site), {
    status: 'unavailable',
    reason: 'invalid_archive',
    entries: null,
  });
  assert.equal(await store.save(randomUUID(), tree), false, 'no upload, no row');
});

test('the worker loop indexes at start, logs ids and machine codes only, and stops', async (t) => {
  const { f } = await fixture(t);
  const site = await publish(f, 'site.zip', await archive());
  const broken = await publish(f, 'broken.zip', Buffer.from('not an archive'));
  const down = await publish(f, 'down.zip', await archive());
  const local = new LocalBlobStore(f.directory, 0);
  // The storage of one archive does not answer: it is retried later, the others go on.
  const blobs = {
    read(id, ...rest) {
      if (id === down) throw new ArkvoryError('unavailable', 'Storage is down');
      return local.read(id, ...rest);
    },
  };
  const lines = [];
  const stop = new AbortController();
  const loop = runTreeIndexing({
    catalog: { pool: f.catalog.pool, sessions: f.catalog.sessions, active: true },
    blobs,
    stop: stop.signal,
    diagnostics: { write: (line) => lines.push(line) },
    pollMs: 20,
  });
  for (let wait = 0; wait < 400 && lines.length < 3; wait++) await delay(25);
  stop.abort();
  await loop;
  const byCode = Object.fromEntries(lines.map(({ code, ...line }) => [code, line]));
  assert.deepEqual(byCode, {
    'tree.index_built': {
      level: 'info',
      component: 'tree',
      artifactId: site,
      entries: files.length,
    },
    'tree.index_unavailable': {
      level: 'info',
      component: 'tree',
      artifactId: broken,
      reason: 'not_archive',
    },
    'tree.index_failed': {
      level: 'warning',
      component: 'tree',
      artifactId: down,
      errorCode: 'unavailable',
      attempts: 1,
      retryInSeconds: 30,
    },
  });
  assert.equal(lines.length, 3, 'the failing archive waits for its pause');
  assert.ok(!JSON.stringify(lines).includes('site/'), 'no entry paths in logs');
  const pending = (await tree(f.app, down, f.headers)).json();
  assert.equal(pending.status, 'pending');
});
