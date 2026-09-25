import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { ZipFile } from 'yazl';
import {
  LocalBlobStore,
  PostgresJobs,
  PostgresCleanup,
  PostgresCatalog,
} from '@proanima/depot-infrastructure';
import { GarbageCollector } from '@proanima/depot-application';
import { setup, create, base } from './fixture.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
test('expired sessions cannot accept parts and revoked worker permissions prevent publication', async (t) => {
  const f = await setup(t);
  const bytes = Buffer.from('revocation');
  const id = (await create(f, bytes)).json().id;
  await f.catalog.pool.query(
    "UPDATE depot_uploads SET expires_at=now()-interval '1 second' WHERE id=$1",
    [id],
  );
  const put = await f.app.inject({
    method: 'PUT',
    url: `${base}/uploads/${id}/parts/0`,
    headers: {
      ...f.headers,
      'content-type': 'application/octet-stream',
      'x-content-sha256': sha(bytes),
    },
    payload: bytes,
  });
  assert.equal(put.statusCode, 409);
  const other = (await create(f, bytes)).json().id;
  await f.app.inject({
    method: 'PUT',
    url: `${base}/uploads/${other}/parts/0`,
    headers: {
      ...f.headers,
      'content-type': 'application/octet-stream',
      'x-content-sha256': sha(bytes),
    },
    payload: bytes,
  });
  const queued = await f.app.inject({
    method: 'POST',
    url: `${base}/uploads/${other}/complete-async`,
    headers: f.headers,
  });
  const keys = join(f.directory, 'revoked-keys.json');
  await writeFile(
    keys,
    JSON.stringify(
      f.config.keys.map((key) => ({ ...key.principal, permissions: ['read'], sha256: key.sha256 })),
    ),
  );
  const result = await child(
    'apps/worker/dist/main.js',
    {
      DEPOT_DATABASE_URL: f.config.databaseUrl,
      DEPOT_DATA_DIR: f.directory,
      DEPOT_KEYS_FILE: keys,
    },
    ['--once'],
  );
  assert.equal(result.code, 0, result.output);
  const job = await new PostgresJobs(f.catalog.pool).get(queued.json().id);
  assert.equal(job.status, 'failed');
  assert.equal(job.errorCode, 'forbidden');
  assert.equal((await f.catalog.get('releases', other)).status, 'pending');
});
async function publish(f, bytes) {
  const id = (await create(f, bytes)).json().id;
  const response = await f.app.inject({
    method: 'PUT',
    url: `${base}/uploads/${id}/content`,
    headers: { ...f.headers, 'content-type': 'application/octet-stream' },
    payload: bytes,
  });
  assert.equal(response.statusCode, 200, response.body);
  return id;
}
async function zip(manifest, options = {}) {
  const value = new ZipFile();
  value.addBuffer(Buffer.from(JSON.stringify(manifest)), 'upack.json');
  value.addBuffer(Buffer.from('payload'), 'package/hello.txt', options);
  value.end();
  const chunks = [];
  for await (const chunk of value.outputStream) chunks.push(chunk);
  return Buffer.concat(chunks);
}
async function child(file, env, args = []) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [file, ...args], {
      env: { ...process.env, ...env },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    p.stdout.on('data', (b) => (output += b));
    p.stderr.on('data', (b) => (output += b));
    p.on('error', reject);
    p.on('exit', (code) => resolve({ code, output }));
  });
}

test('multipart survives restart, rejects gaps/conflicting parts, preserves original bytes', async (t) => {
  const f = await setup(t);
  const bytes = Buffer.alloc(8 * 1024 ** 2 + 17, 23);
  const id = (await create(f, bytes)).json().id;
  const part = (index, data, hash = sha(data)) =>
    f.app.inject({
      method: 'PUT',
      url: `${base}/uploads/${id}/parts/${index}`,
      headers: {
        ...f.headers,
        'content-type': 'application/octet-stream',
        'x-content-sha256': hash,
      },
      payload: data,
    });
  assert.equal((await part(1, bytes.subarray(8 * 1024 ** 2))).statusCode, 204);
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: `${base}/uploads/${id}/complete`,
        headers: f.headers,
      })
    ).statusCode,
    409,
  );
  await f.restart();
  assert.equal(
    (await f.app.inject({ url: `${base}/uploads/${id}/parts`, headers: f.headers })).json().items
      .length,
    1,
  );
  assert.equal((await part(1, Buffer.alloc(17, 9))).statusCode, 409);
  assert.equal((await part(0, bytes.subarray(0, 8 * 1024 ** 2), '0'.repeat(64))).statusCode, 422);
  assert.equal((await part(0, bytes.subarray(0, 8 * 1024 ** 2))).statusCode, 204);
  const complete = await f.app.inject({
    method: 'POST',
    url: `${base}/uploads/${id}/complete`,
    headers: f.headers,
  });
  assert.equal(complete.statusCode, 200, complete.body);
  assert.deepEqual(
    (await f.app.inject({ url: `${base}/artifacts/${id}/content`, headers: f.headers })).rawPayload,
    bytes,
  );
});

test('offline GC requires exclusive maintenance, retains published bytes, releases cancelled quota after deletion', async (t) => {
  const f = await setup(t, { capacityBytes: 16 });
  const data = Buffer.alloc(8);
  const kept = await publish(f, data);
  const discarded = (await create(f, data)).json().id;
  const blobs = new LocalBlobStore(f.directory, 0);
  await blobs.putPart(
    discarded,
    { index: 0, size: 8, sha256: sha(data) },
    (async function* () {
      yield data;
    })(),
    { throwIfAborted() {} },
  );
  await f.app.inject({ method: 'DELETE', url: `${base}/uploads/${discarded}`, headers: f.headers });
  assert.equal((await create(f, data)).statusCode, 507);
  const maintenance = new PostgresCatalog(f.config.databaseUrl, 16, 1);
  let closed = false;
  t.after(async () => {
    if (!closed) await maintenance.close();
  });
  await assert.rejects(maintenance.claimStorage(await blobs.identity(), 'maintenance'), {
    code: 'busy',
  });
  await f.app.close();
  await maintenance.claimStorage(await blobs.identity(), 'maintenance');
  const gc = new GarbageCollector(new PostgresCleanup(maintenance.pool), blobs, {
    throwIfAborted() {
      if (!maintenance.active) throw new Error('Maintenance claim lost');
    },
  });
  await gc.run(new Date().toISOString(), 0);
  assert.deepEqual(await readFile(blobs.contentPath(kept)), data);
  await assert.rejects(readFile(blobs.contentPath(discarded)), { code: 'ENOENT' });
  await maintenance.close();
  closed = true;
  await f.restart();
  assert.equal((await create(f, data)).statusCode, 201);
});

test('leased completion jobs fence stale workers and real worker publishes with current authorization', async (t) => {
  const f = await setup(t);
  const bytes = Buffer.from('worker content');
  const id = (await create(f, bytes)).json().id;
  await f.app.inject({
    method: 'PUT',
    url: `${base}/uploads/${id}/parts/0`,
    headers: {
      ...f.headers,
      'content-type': 'application/octet-stream',
      'x-content-sha256': sha(bytes),
    },
    payload: bytes,
  });
  const response = await f.app.inject({
    method: 'POST',
    url: `${base}/uploads/${id}/complete-async`,
    headers: f.headers,
  });
  assert.equal(response.statusCode, 202, response.body);
  const job = response.json();
  const jobs = new PostgresJobs(f.catalog.pool);
  const old = await jobs.take();
  assert.equal(old.id, job.id);
  await f.catalog.pool.query(
    "UPDATE depot_jobs SET lease_until=now()-interval '1 second' WHERE id=$1",
    [job.id],
  );
  const next = await jobs.take();
  assert.equal(next.generation, old.generation + 1);
  assert.equal(await jobs.finish(old.id, old.generation, null), false);
  await f.catalog.pool.query(
    "UPDATE depot_jobs SET lease_until=now()-interval '1 second' WHERE id=$1",
    [job.id],
  );
  const keys = join(f.directory, 'keys.json');
  await writeFile(
    keys,
    JSON.stringify(f.config.keys.map((key) => ({ ...key.principal, sha256: key.sha256 }))),
  );
  const result = await child(
    'apps/worker/dist/main.js',
    {
      DEPOT_DATABASE_URL: f.config.databaseUrl,
      DEPOT_DATA_DIR: f.directory,
      DEPOT_KEYS_FILE: keys,
    },
    ['--once'],
  );
  assert.equal(result.code, 0, result.output);
  assert.equal((await jobs.get(job.id)).status, 'completed');
  assert.equal((await f.catalog.get('releases', id)).status, 'available');
});

test('annotations CAS, asset revisions, immutable UPack versions, search and audit enforce ACL', async (t) => {
  const f = await setup(t);
  const manifest = { name: 'engine', group: 'tools', version: '1.0.0', custom: { hello: 'world' } };
  const bytes = await zip(manifest);
  const id = await publish(f, bytes);
  const register = () =>
    f.app.inject({ method: 'POST', url: `${base}/artifacts/${id}/package`, headers: f.headers });
  const registered = await register();
  assert.equal(registered.statusCode, 200, registered.body);
  assert.deepEqual(registered.json().manifest, manifest);
  const other = await publish(f, await zip({ ...manifest, custom: 'different' }));
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: `${base}/artifacts/${other}/package`,
        headers: f.headers,
      })
    ).statusCode,
    409,
  );
  const annotation = (expectedRevision) =>
    f.app.inject({
      method: 'PUT',
      url: `${base}/artifacts/${id}/annotations`,
      headers: f.headers,
      payload: {
        expectedRevision,
        value: { labels: ['stable'], metadata: { channel: 'prod' }, collections: ['tools'] },
      },
    });
  assert.equal((await annotation(0)).json().revision, 1);
  assert.equal((await annotation(0)).statusCode, 409);
  assert.equal(
    (
      await f.app.inject({
        url: `${base}/search?label=stable&collection=tools`,
        headers: f.readerHeaders,
      })
    ).json().items[0].id,
    id,
  );
  const asset = (expectedRevision) =>
    f.app.inject({
      method: 'PUT',
      url: `${base}/asset`,
      headers: f.headers,
      payload: { path: 'releases/current.upack', artifactId: id, expectedRevision },
    });
  assert.equal((await asset(0)).json().revision, 1);
  assert.equal((await asset(0)).statusCode, 409);
  assert.equal((await asset(1)).json().revision, 2);
  assert.equal(
    (
      await f.app.inject({
        url: `${base}/asset?path=releases/current.upack`,
        headers: f.readerHeaders,
      })
    ).json().artifactId,
    id,
  );
  assert.equal(
    (await f.app.inject({ url: `${base}/audit`, headers: f.readerHeaders })).statusCode,
    403,
  );
  assert(
    (await f.app.inject({ url: `${base}/audit`, headers: f.headers })).json().items.length >= 4,
  );
  const invalid = await publish(f, await zip({ ...manifest, version: '01.0.0' }));
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: `${base}/artifacts/${invalid}/package`,
        headers: f.headers,
      })
    ).statusCode,
    400,
  );
  const symlink = await publish(
    f,
    await zip({ ...manifest, version: '2.0.0' }, { mode: 0o120777 }),
  );
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: `${base}/artifacts/${symlink}/package`,
        headers: f.headers,
      })
    ).statusCode,
    400,
  );
  assert.deepEqual(
    (await f.app.inject({ url: `${base}/artifacts/${id}/content`, headers: f.headers })).rawPayload,
    bytes,
  );
});
