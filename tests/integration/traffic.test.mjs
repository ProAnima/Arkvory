import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DepotClient } from '@proanima/depot-sdk';
import { loadConfig } from '../../apps/api/dist/index.js';
import { setup, create, base } from './fixture.mjs';

async function publish(f, bytes) {
  const id = (await create(f, bytes)).json().id;
  const sent = await f.app.inject({
    method: 'PUT',
    url: `${base}/uploads/${id}/content`,
    headers: { ...f.headers, 'content-type': 'application/octet-stream' },
    payload: bytes,
  });
  assert.equal(sent.statusCode, 200, sent.body);
  return id;
}
async function eventually(action) {
  const deadline = performance.now() + 3000;
  do {
    if (await action()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  } while (performance.now() < deadline);
  assert.fail('Timed out waiting for transfer state');
}

test('parallel downloads share principal quota across keys; native, Range and legacy preserve bytes', async (t) => {
  const f = await setup(t, {
    downloadBytesPerSecond: 262144,
    downloadBytesPerSecondPerPrincipal: 65536,
    maxDownloads: 4,
    maxDownloadsPerPrincipal: 4,
  });
  const alternate = 'alternate-' + randomUUID();
  f.config.keys.push({
    sha256: createHash('sha256').update(alternate).digest('hex'),
    principal: f.config.keys[0].principal,
  });
  const bytes = Buffer.alloc(128 * 1024, 0x5b),
    id = await publish(f, bytes);
  const address = await f.listen();
  const client = new DepotClient(address, () => f.headers.authorization.slice(7));
  await client.setAsset('releases', 'release.bin', id, 0);
  let otherFinished = 0;
  const start = performance.now();
  const [first, second, other] = await Promise.all([
    fetch(`${address}${base}/artifacts/${id}/content`, { headers: f.headers }).then((r) =>
      r.arrayBuffer(),
    ),
    fetch(`${address}/endpoints/releases/content/release.bin`, {
      headers: { authorization: `Bearer ${alternate}` },
    }).then((r) => r.arrayBuffer()),
    fetch(`${address}${base}/artifacts/${id}/content`, { headers: f.readerHeaders }).then(
      async (r) => {
        const data = await r.arrayBuffer();
        otherFinished = performance.now() - start;
        return data;
      },
    ),
  ]);
  const duration = performance.now() - start;
  for (const data of [first, second, other]) assert.deepEqual(Buffer.from(data), bytes);
  assert(duration >= 3700, `Principal limit bypassed: ${duration} ms`);
  assert(
    otherFinished < duration - 500,
    `Other principal was blocked: ${otherFinished}/${duration}`,
  );
  const ranged = await fetch(`${address}${base}/artifacts/${id}/content`, {
    headers: { ...f.headers, range: 'bytes=65536-65567' },
  });
  assert.equal(ranged.status, 206);
  assert.deepEqual(Buffer.from(await ranged.arrayBuffer()), bytes.subarray(65536, 65568));
  const contentUrl = `${address}${base}/artifacts/${id}/content`;
  assert.equal((await fetch(contentUrl, { method: 'HEAD', headers: f.headers })).status, 200);
  assert.equal(
    (
      await fetch(contentUrl, {
        headers: { ...f.headers, 'if-none-match': ranged.headers.get('etag') },
      })
    ).status,
    304,
  );
  assert.equal(
    (await fetch(contentUrl, { headers: { ...f.headers, range: 'bytes=9999999-' } })).status,
    416,
  );
  const ready = await (await fetch(address + '/health/ready', { headers: f.readerHeaders })).json();
  assert.equal(ready.transfers.downloads.bandwidth.grantedBytes, String(3 * bytes.length + 32));
  assert.equal(ready.transfers.downloads.admission.active, 0);
  assert.equal((await fetch(address + '/health/ready')).status, 401);
  assert(!JSON.stringify(ready).includes('test-writer'));
});

test('full and multipart uploads share aggregate budget and retain checksum validation', async (t) => {
  const f = await setup(t, { uploadBytesPerSecond: 65536, maxUploadsPerPrincipal: 2 });
  const address = await f.listen(),
    bytes = Buffer.alloc(65536, 0x71);
  const one = (await create(f, bytes)).json().id,
    two = (await create(f, bytes)).json().id;
  const digest = createHash('sha256').update(bytes).digest('hex');
  const start = performance.now();
  const result = await Promise.all([
    fetch(`${address}${base}/uploads/${one}/content`, {
      method: 'PUT',
      headers: { ...f.headers, 'content-type': 'application/octet-stream' },
      body: bytes,
    }),
    fetch(`${address}${base}/uploads/${two}/parts/0`, {
      method: 'PUT',
      headers: {
        ...f.headers,
        'content-type': 'application/octet-stream',
        'x-content-sha256': digest,
      },
      body: bytes,
    }),
  ]);
  assert.equal(result[0].status, 200, await result[0].text());
  assert.equal(result[1].status, 204, await result[1].text());
  assert(performance.now() - start >= 1800);
  const completed = await f.app.inject({
    method: 'POST',
    url: `${base}/uploads/${two}/complete`,
    headers: f.headers,
  });
  assert.equal(completed.statusCode, 200, completed.body);
  const ready = (await f.app.inject({ url: '/health/ready', headers: f.headers })).json();
  assert.equal(ready.transfers.uploads.bandwidth.grantedBytes, '131072');
  assert.equal(ready.transfers.uploads.admission.active, 0);
});

test('queued cancellation releases admission and preClose aborts active bandwidth waits', async (t) => {
  const f = await setup(t, { downloadBytesPerSecond: 65536, maxDownloadsPerPrincipal: 1 });
  const bytes = Buffer.alloc(512 * 1024, 0x69),
    id = await publish(f, bytes),
    address = await f.listen();
  const ready = async () =>
    (await f.app.inject({ url: '/health/ready', headers: f.headers })).json();
  const first = await fetch(`${address}${base}/artifacts/${id}/content`, { headers: f.headers });
  const stop = new AbortController();
  const waiting = fetch(`${address}${base}/artifacts/${id}/content`, {
    headers: f.headers,
    signal: stop.signal,
  });
  const cancelled = assert.rejects(waiting, { name: 'AbortError' });
  await eventually(async () => (await ready()).transfers.downloads.admission.waiting === 1);
  stop.abort();
  await cancelled;
  await eventually(async () => (await ready()).transfers.downloads.admission.waiting === 0);
  assert.equal((await ready()).transfers.downloads.admission.cancelled, 1);
  const body = first.arrayBuffer();
  const interrupted = assert.rejects(body);
  await f.app.close();
  await interrupted;
  await f.restart();
  const restored = await f.app.inject({
    url: `${base}/artifacts/${id}/content`,
    headers: { ...f.headers, range: 'bytes=0-15' },
  });
  assert.equal(restored.statusCode, 206);
  assert.deepEqual(restored.rawPayload, bytes.subarray(0, 16));
});

test('traffic environment configuration rejects invalid rates and active caps', async (t) => {
  const f = await setup(t),
    path = join(f.directory, 'keys.json');
  await writeFile(
    path,
    JSON.stringify(f.config.keys.map((k) => ({ ...k.principal, sha256: k.sha256 }))),
  );
  const env = {
    DEPOT_DATABASE_URL: f.config.databaseUrl,
    DEPOT_DATA_DIR: f.directory,
    DEPOT_KEYS_FILE: path,
  };
  const defaults = await loadConfig(env);
  assert.equal(defaults.role, 'api');
  assert.equal(defaults.sharedDownloads, undefined);
  const shared = {
    ...env,
    DEPOT_ROLE: 'reader',
    DEPOT_GATEWAY_SLOT: '1',
    DEPOT_GATEWAY_SLOTS: '2',
    DEPOT_SHARED_DOWNLOAD_BYTES_PER_SECOND: '131072',
  };
  assert.deepEqual((await loadConfig(shared)).sharedDownloads, {
    slots: 2,
    slot: 1,
    bytesPerSecond: 131072,
    perPrincipalBytesPerSecond: 0,
  });
  for (const invalid of [
    { DEPOT_ROLE: 'replica' },
    { DEPOT_GATEWAY_SLOT: '0' },
    { DEPOT_GATEWAY_SLOT: '2' },
    { DEPOT_GATEWAY_SLOTS: '1' },
    { DEPOT_SHARED_DOWNLOAD_BYTES_PER_SECOND: '65536' },
    { DEPOT_SHARED_DOWNLOAD_BYTES_PER_SECOND_PER_PRINCIPAL: '65536' },
    { DEPOT_ROLE: 'api' },
  ])
    await assert.rejects(loadConfig({ ...shared, ...invalid }));
  await assert.rejects(loadConfig({ ...env, DEPOT_ROLE: 'reader' }));
  await assert.rejects(loadConfig({ ...env, DEPOT_GATEWAY_SLOT: '0' }));
  assert.equal(defaults.downloadBytesPerSecond, 0);
  assert.equal(defaults.maxDownloadsPerPrincipal, 4);
  for (const value of ['-1', '1', '65535', '1e6', 'Infinity', '1.5', ' 65536', '1099511627777'])
    await assert.rejects(loadConfig({ ...env, DEPOT_DOWNLOAD_BYTES_PER_SECOND: value }));
  await assert.rejects(loadConfig({ ...env, DEPOT_MAX_DOWNLOADS_PER_PRINCIPAL: '17' }));
  assert.equal(
    (await loadConfig({ ...env, DEPOT_DOWNLOAD_BYTES_PER_SECOND: '65536' })).downloadBytesPerSecond,
    65536,
  );
});

test('loss of database ownership interrupts active throttled delivery and requires restart', async (t) => {
  const f = await setup(t, { downloadBytesPerSecond: 65536 });
  const bytes = Buffer.alloc(512 * 1024, 0x76),
    id = await publish(f, bytes),
    address = await f.listen();
  const response = await fetch(`${address}${base}/artifacts/${id}/content`, { headers: f.headers });
  assert.equal(response.status, 200);
  const interrupted = assert.rejects(response.arrayBuffer());
  const killed = await f.catalog.pool
    .query(`SELECT pg_terminate_backend(pid) AS killed FROM pg_locks
    WHERE locktype='advisory' AND classid=18471 AND objid=3 AND objsubid=2 AND granted
    AND database=(SELECT oid FROM pg_database WHERE datname=current_database())`);
  assert.equal(killed.rows.length, 1);
  assert.equal(killed.rows[0].killed, true);
  await interrupted;
  assert.equal((await f.app.inject({ url: '/health/ready', headers: f.headers })).statusCode, 503);
  await f.restart();
  const restored = await f.app.inject({
    url: `${base}/artifacts/${id}/content`,
    headers: { ...f.headers, range: 'bytes=0-15' },
  });
  assert.equal(restored.statusCode, 206);
  assert.deepEqual(restored.rawPayload, bytes.subarray(0, 16));
});
