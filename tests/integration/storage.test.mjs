import { removeTestDirectory } from '../helpers.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from '../../apps/api/dist/index.js';
import { LocalBlobStore } from '@proanima/depot-infrastructure';
import { setup, create, descriptor, base } from './fixture.mjs';

test('HTTP publication, auth, idempotency, Range and restart against real PostgreSQL', async (t) => {
  const f = await setup(t);
  const bytes = Buffer.from('original package content');
  const key = randomUUID();
  assert.equal((await f.app.inject({ url: `${base}/artifacts` })).statusCode, 401);
  const first = await create(f, bytes, key);
  assert.equal(first.statusCode, 201, first.body);
  const id = first.json().id;
  assert.equal((await create(f, bytes, key)).json().id, id);
  assert.equal((await create(f, Buffer.from('other'), key)).statusCode, 409);
  assert.equal(
    (await f.app.inject({ url: `${base}/artifacts/${id}/content`, headers: f.headers })).statusCode,
    404,
  );
  const denied = await f.app.inject({
    method: 'PUT',
    url: `${base}/uploads/${id}/content`,
    headers: { ...f.readerHeaders, 'content-type': 'application/octet-stream' },
    payload: bytes,
  });
  assert.equal(denied.statusCode, 403);
  const put = await f.app.inject({
    method: 'PUT',
    url: `${base}/uploads/${id}/content`,
    headers: { ...f.headers, 'content-type': 'application/octet-stream' },
    payload: bytes,
  });
  assert.equal(put.statusCode, 200, put.body);
  assert.equal(put.json().status, 'available');
  const complete = () =>
    f.app.inject({ method: 'POST', url: `${base}/uploads/${id}/complete`, headers: f.headers });
  assert.equal((await complete()).json().id, id);
  await f.restart();
  assert.equal((await complete()).json().id, id);
  const download = await f.app.inject({
    url: `${base}/artifacts/${id}/content`,
    headers: f.readerHeaders,
  });
  assert.equal(download.statusCode, 200);
  assert.deepEqual(download.rawPayload, bytes);
  const range = await f.app.inject({
    url: `${base}/artifacts/${id}/content`,
    headers: { ...f.headers, range: 'bytes=3-9', 'if-range': download.headers.etag },
  });
  assert.equal(range.statusCode, 206);
  assert.deepEqual(range.rawPayload, bytes.subarray(3, 10));
  const head = await f.app.inject({
    method: 'HEAD',
    url: `${base}/artifacts/${id}/content`,
    headers: { ...f.headers, range: 'bytes=3-9' },
  });
  assert.equal(head.statusCode, 200);
  assert.equal(head.headers['content-length'], String(bytes.length));
  assert.equal(head.body, '');
  assert.equal(
    (
      await f.app.inject({
        url: `${base}/artifacts/${id}/content`,
        headers: { ...f.headers, 'if-none-match': download.headers.etag },
      })
    ).statusCode,
    304,
  );
  assert.equal(
    (
      await f.app.inject({
        url: `${base}/artifacts/${id}/content`,
        headers: { ...f.headers, range: 'bytes=999-' },
      })
    ).statusCode,
    416,
  );
  assert.equal(
    (
      await f.app.inject({
        url: `${base}/artifacts/${id}/content`,
        headers: { ...f.headers, range: 'bytes=3-9', 'if-range': '"other"' },
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await f.app.inject({
        url: `${base.replace('releases', 'private')}/artifacts/${id}/content`,
        headers: f.headers,
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (await f.app.inject({ method: 'DELETE', url: `${base}/uploads/${id}`, headers: f.headers }))
      .statusCode,
    409,
  );
  const list = await f.app.inject({ url: `${base}/artifacts?limit=1`, headers: f.headers });
  assert.equal(list.json().items[0].id, id);
  assert.equal(list.json().next, id);
  assert.equal(
    (await f.app.inject({ url: `${base}/artifacts?after=${id}`, headers: f.headers })).json().items
      .length,
    0,
  );
  assert.equal(
    (await f.app.inject({ url: '/api/v1/openapi.json', headers: f.headers })).json().openapi,
    '3.0.3',
  );
});

test('checksum failure stays pending and can be retried; cancellation never publishes', async (t) => {
  const f = await setup(t);
  const bytes = Buffer.from('expected');
  const id = (await create(f, bytes)).json().id;
  const put = (payload) =>
    f.app.inject({
      method: 'PUT',
      url: `${base}/uploads/${id}/content`,
      headers: { ...f.headers, 'content-type': 'application/octet-stream' },
      payload,
    });
  assert.equal((await put(Buffer.from('tampered'))).statusCode, 422);
  assert.equal(
    (await f.app.inject({ url: `${base}/uploads/${id}`, headers: f.headers })).json().status,
    'pending',
  );
  assert.equal((await put(bytes)).statusCode, 200);
  const other = (await create(f, bytes)).json().id;
  assert.equal(
    (
      await f.app.inject({ method: 'DELETE', url: `${base}/uploads/${other}`, headers: f.headers })
    ).json().status,
    'cancelled',
  );
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: `${base}/uploads/${other}/complete`,
        headers: f.headers,
      })
    ).statusCode,
    409,
  );
});

test('recovery publishes a persisted blob after missing DB commit; competing mutations are refused', async (t) => {
  const f = await setup(t);
  const bytes = Buffer.from('recover me');
  const id = (await create(f, bytes)).json().id;
  const blobs = new LocalBlobStore(f.directory, 0);
  await blobs.put(
    id,
    { ...descriptor(bytes), size: bytes.length },
    (async function* () {
      yield bytes;
    })(),
    { throwIfAborted() {} },
  );
  await f.restart();
  assert.equal(
    (await f.app.inject({ url: `${base}/artifacts/${id}/content`, headers: f.headers })).statusCode,
    404,
  );
  await f.catalog.exclusive(id, async () => {
    const busy = await f.app.inject({
      method: 'POST',
      url: `${base}/uploads/${id}/complete`,
      headers: f.headers,
    });
    assert.equal(busy.statusCode, 503, busy.body);
  });
  const completed = await f.app.inject({
    method: 'POST',
    url: `${base}/uploads/${id}/complete`,
    headers: f.headers,
  });
  assert.equal(completed.statusCode, 200, completed.body);
  assert.equal(
    (await f.app.inject({ url: `${base}/artifacts/${id}/content`, headers: f.headers })).body,
    bytes.toString(),
  );
});

test('concurrent reservations cannot overbook capacity and idempotent calls share one ID', async (t) => {
  const f = await setup(t, { capacityBytes: 8 });
  const bytes = Buffer.alloc(8);
  const key = randomUUID();
  const same = await Promise.all(Array.from({ length: 5 }, () => create(f, bytes, key)));
  assert(same.every((x) => x.statusCode === 201));
  assert.equal(new Set(same.map((x) => x.json().id)).size, 1);
  assert.equal((await create(f, bytes)).statusCode, 507);
});

test('standalone rejects a second API and a database attached to a different directory', async (t) => {
  const f = await setup(t);
  await assert.rejects(createServer(f.config), { code: 'busy' });
  await f.app.close();
  const other = await mkdtemp(join(tmpdir(), 'depot-wrong-root-'));
  t.after(() => removeTestDirectory(other));
  await assert.rejects(createServer({ ...f.config, dataDirectory: other }), { code: 'conflict' });
  await f.restart();
  assert.equal((await f.app.inject({ url: '/health/ready', headers: f.headers })).statusCode, 200);
});

test('lost upload lock connection cannot publish through a different connection', async (t) => {
  const f = await setup(t);
  const id = (await create(f, Buffer.from('x'))).json().id;
  const digest = createHash('sha256').update(id).digest();
  await assert.rejects(
    f.catalog.exclusive(id, async (mutation) => {
      const killed = await f.catalog.pool.query(
        `SELECT pg_terminate_backend(pid) AS killed FROM pg_locks WHERE locktype='advisory' AND classid=$1::oid AND objid=$2::oid AND objsubid=1 AND granted`,
        [digest.readUInt32BE(0), digest.readUInt32BE(4)],
      );
      assert.equal(killed.rows[0]?.killed, true);
      await mutation.publish('releases');
    }),
  );
  assert.equal((await f.catalog.get('releases', id)).status, 'pending');
});

test('only the owner can inspect a pending upload and metadata remains bounded', async (t) => {
  const f = await setup(t);
  const id = (await create(f, Buffer.from('x'))).json().id;
  assert.equal(
    (await f.app.inject({ url: `${base}/uploads/${id}`, headers: f.readerHeaders })).statusCode,
    403,
  );
  const response = await f.app.inject({
    method: 'POST',
    url: `${base}/uploads`,
    headers: { ...f.headers, 'idempotency-key': randomUUID() },
    payload: { ...descriptor(Buffer.from('x')), metadata: { oversized: 'x'.repeat(1025) } },
  });
  assert.equal(response.statusCode, 400);
  assert(!response.body.includes(f.directory));
  assert.equal(
    (await f.app.inject({ url: `${base}/artifacts?limit=0`, headers: f.headers })).statusCode,
    400,
  );
});

test('real HTTP rejects oversized bytes without publishing and serves an empty object', async (t) => {
  const f = await setup(t);
  const address = await f.listen();
  const id = (await create(f, Buffer.from('x'))).json().id;
  const rejected = await fetch(`${address}${base}/uploads/${id}/content`, {
    method: 'PUT',
    headers: { ...f.headers, 'content-type': 'application/octet-stream' },
    body: Buffer.alloc(1024, 1),
  });
  assert.equal(rejected.status, 422, await rejected.text());
  assert.equal((await f.catalog.get('releases', id)).status, 'pending');
  const empty = (await create(f, Buffer.alloc(0))).json().id;
  const sent = await fetch(`${address}${base}/uploads/${empty}/content`, {
    method: 'PUT',
    headers: { ...f.headers, 'content-type': 'application/octet-stream' },
    body: Buffer.alloc(0),
  });
  assert.equal(sent.status, 200, await sent.text());
  const downloaded = await fetch(`${address}${base}/artifacts/${empty}/content`, {
    headers: f.headers,
  });
  assert.equal(downloaded.status, 200);
  assert.equal(downloaded.headers.get('content-length'), '0');
  assert.equal(await downloaded.text(), '');
});
