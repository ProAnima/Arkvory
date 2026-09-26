import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { createServer as tcpServer, connect } from 'node:net';
import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from '../../apps/api/dist/index.js';
import { PostgresCatalog, PostgresDownloadLease } from '@proanima/arkvory-infrastructure';
import { ArkvoryClient } from '@proanima/arkvory-sdk';
import { setup, create, base } from './fixture.mjs';

const policy = {
  slots: 3,
  slot: 0,
  bytesPerSecond: 3 * 65536,
  perPrincipalBytesPerSecond: 3 * 65536,
};
async function fixture(t, shared = true) {
  const cleanup = [];
  t.after(async () => {
    for (const action of cleanup.reverse()) await action();
  });
  const f = await setup(
    { after: (action) => cleanup.push(action) },
    shared ? { sharedDownloads: policy } : {},
  );
  return { ...f, cleanup };
}
const readerConfig = (f, slot) => ({
  ...f.config,
  role: 'reader',
  sharedDownloads: { ...policy, slot },
  downloadBytesPerSecond: policy.bytesPerSecond * 2,
  downloadBytesPerSecondPerPrincipal: policy.perPrincipalBytesPerSecond * 2,
});
async function publish(f, bytes) {
  const id = (await create(f, bytes)).json().id;
  const result = await f.app.inject({
    method: 'PUT',
    url: `${base}/uploads/${id}/content`,
    headers: { ...f.headers, 'content-type': 'application/octet-stream' },
    payload: bytes,
  });
  assert.equal(result.statusCode, 200, result.body);
  return id;
}
async function childReader(f, slot) {
  const child = fork('tests/integration/api-child.mjs', [], {
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    windowsHide: true,
  });
  f.cleanup.push(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const ended = once(child, 'exit');
      child.kill('SIGKILL');
      await ended;
    }
  });
  child.send(readerConfig(f, slot));
  const [result] = await once(child, 'message');
  assert(!result.error, result.error);
  return { child, address: result.address };
}

test('writer and two independent read processes share bandwidth, ACL and immutable content', async (t) => {
  const f = await fixture(t),
    bytes = Buffer.alloc(128 * 1024, 0x53),
    id = await publish(f, bytes);
  const primary = await f.listen(),
    one = await childReader(f, 1),
    two = await childReader(f, 2);
  const client = new ArkvoryClient(primary, () => f.headers.authorization.slice(7));
  await client.setAsset('releases', 'shared.bin', id, 0);
  const started = performance.now();
  const bodies = await Promise.all(
    [primary, one.address, two.address].map(async (address) => {
      const response = await fetch(`${address}${base}/artifacts/${id}/content`, {
        headers: f.headers,
      });
      assert.equal(response.status, 200);
      return Buffer.from(await response.arrayBuffer());
    }),
  );
  assert(performance.now() - started >= 1750, 'Cluster limit multiplied by process count');
  for (const body of bodies) assert.deepEqual(body, bytes);
  for (const address of [one.address, two.address]) {
    const health = await (
      await fetch(address + '/health/ready', { headers: f.readerHeaders })
    ).json();
    assert.equal(health.role, 'reader');
    assert.equal(health.writable, false);
    assert.equal(health.transfers.downloads.bandwidth.bytesPerSecond, 65536);
    assert.equal(health.transfers.downloads.bandwidth.perPrincipalBytesPerSecond, 65536);
    assert.equal(health.sharedDownloads.active, true);
    const legacy = await fetch(address + '/endpoints/releases/content/shared.bin', {
      headers: { ...f.readerHeaders, range: 'bytes=13-42' },
    });
    assert.equal(legacy.status, 206);
    assert.deepEqual(Buffer.from(await legacy.arrayBuffer()), bytes.subarray(13, 43));
    assert.equal((await fetch(`${address}${base}/artifacts/${id}/content`)).status, 401);
    assert.equal(
      (
        await fetch(`${address}/api/v1/repositories/secret/artifacts/${id}/content`, {
          headers: f.headers,
        })
      ).status,
      403,
    );
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const refused = await fetch(`${address}${base}/uploads/${id}`, {
        method,
        headers: f.headers,
      });
      assert.equal(refused.status, 405);
      assert.equal(refused.headers.get('allow'), 'GET, HEAD');
    }
  }
  const response = await fetch(`${one.address}${base}/artifacts/${id}/content`, {
    headers: f.headers,
  });
  const interrupted = assert.rejects(response.arrayBuffer());
  const ended = once(one.child, 'exit');
  one.child.kill('SIGKILL');
  await ended;
  await interrupted;
  const recovered = await client.downloadVerified('releases', id);
  assert.deepEqual(Buffer.from(await new Response(recovered).arrayBuffer()), bytes);
});

test('duplicate slots, policy mismatch, standalone bypass and maintenance are rejected', async (t) => {
  const f = await fixture(t);
  const reader = await createServer(readerConfig(f, 1));
  f.cleanup.push(() => reader.close());
  await assert.rejects(createServer(readerConfig(f, 1)), { code: 'busy' });
  await assert.rejects(
    createServer({
      ...readerConfig(f, 2),
      sharedDownloads: { ...policy, slot: 2, bytesPerSecond: policy.bytesPerSecond * 2 },
    }),
    { code: 'conflict' },
  );
  const empty = join(f.directory, 'uninitialized-reader');
  await mkdir(empty);
  await assert.rejects(createServer({ ...readerConfig(f, 2), dataDirectory: empty }));
  assert.deepEqual(await readdir(empty), []);
  await f.app.close();
  const { sharedDownloads, ...standalone } = f.config;
  await assert.rejects(createServer(standalone), { code: 'busy' });
  const maintenance = new PostgresCatalog(f.config.databaseUrl, f.config.capacityBytes, 1);
  try {
    const identity = (await f.catalog.pool.query('SELECT storage_id FROM arkvory_storage_identity'))
      .rows[0].storage_id;
    await assert.rejects(maintenance.claimStorage(identity, 'maintenance'), { code: 'busy' });
  } finally {
    await maintenance.close();
  }
  await reader.close();
  await assert.rejects(createServer(standalone), { code: 'conflict' });
});

test('lease close keeps the slot reserved; expiry increments generation and old owner stays fenced', async (t) => {
  const f = await fixture(t),
    lease = new PostgresDownloadLease(f.catalog.pool, { ...policy, slot: 1 });
  f.cleanup.push(() => lease.close());
  await lease.start();
  const before = (
    await f.catalog.pool.query(
      'SELECT generation::text,expires_at FROM arkvory_gateway_leases WHERE slot=1',
    )
  ).rows[0];
  lease.close();
  const replacement = new PostgresDownloadLease(f.catalog.pool, { ...policy, slot: 1 });
  await assert.rejects(replacement.start(), { code: 'busy' });
  await assert.rejects(lease.renew(), { code: 'unavailable' });
  await new Promise((resolve) =>
    setTimeout(resolve, Math.max(0, before.expires_at.getTime() - Date.now()) + 100),
  );
  const next = new PostgresDownloadLease(f.catalog.pool, { ...policy, slot: 1 });
  f.cleanup.push(() => next.close());
  await next.start();
  assert.equal(
    (await f.catalog.pool.query('SELECT generation::text FROM arkvory_gateway_leases WHERE slot=1'))
      .rows[0].generation,
    String(BigInt(before.generation) + 1n),
  );
  assert.equal(lease.active, false);
  assert.equal(next.active, true);
});

async function databaseProxy(f) {
  let stalled = false;
  const target = new URL(f.config.databaseUrl),
    sockets = new Set();
  const destination = { host: target.hostname, port: Number(target.port || 5432) };
  const server = tcpServer((client) => {
    const upstream = connect(destination);
    sockets.add(client);
    sockets.add(upstream);
    client.on('error', () => upstream.destroy());
    upstream.on('error', () => client.destroy());
    client.on('close', () => {
      sockets.delete(client);
      upstream.destroy();
    });
    upstream.on('close', () => {
      sockets.delete(upstream);
      client.destroy();
    });
    client.pipe(upstream).pipe(client);
    if (stalled) {
      client.pause();
      upstream.pause();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  f.cleanup.push(
    () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(resolve);
      }),
  );
  target.hostname = '127.0.0.1';
  target.port = String(server.address().port);
  return {
    url: target.toString(),
    stall() {
      stalled = true;
      for (const socket of sockets) socket.pause();
    },
    resume() {
      stalled = false;
      for (const socket of sockets) socket.resume();
    },
  };
}

test('a stalled database link expires delivery locally; restored connectivity cannot revive the old gateway', async (t) => {
  const f = await fixture(t),
    bytes = Buffer.alloc(1024 * 1024, 0x61),
    id = await publish(f, bytes);
  const proxy = await databaseProxy(f);
  const old = await createServer({ ...readerConfig(f, 1), databaseUrl: proxy.url });
  f.cleanup.push(async () => {
    proxy.resume();
    await old.close();
  });
  const address = await old.listen({ host: '127.0.0.1', port: 0 });
  const response = await fetch(`${address}${base}/artifacts/${id}/content`, { headers: f.headers });
  const interrupted = assert.rejects(response.arrayBuffer());
  const started = performance.now();
  proxy.stall();
  await interrupted;
  assert(performance.now() - started < 9500, 'Gateway outlived local lease validity');
  assert.equal((await fetch(address + '/health/ready', { headers: f.headers })).status, 503);
  await assert.rejects(createServer(readerConfig(f, 1)), { code: 'busy' });
  const remaining = (
    await f.catalog.pool.query(
      'SELECT GREATEST(0,EXTRACT(EPOCH FROM (expires_at-clock_timestamp()))*1000)::float AS ms FROM arkvory_gateway_leases WHERE slot=1',
    )
  ).rows[0].ms;
  await new Promise((resolve) => setTimeout(resolve, remaining + 100));
  const next = await createServer(readerConfig(f, 1));
  f.cleanup.push(() => next.close());
  proxy.resume();
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal((await fetch(address + '/health/ready', { headers: f.headers })).status, 503);
  const restored = await next.inject({
    url: `${base}/artifacts/${id}/content`,
    headers: { ...f.headers, range: 'bytes=0-15' },
  });
  assert.equal(restored.statusCode, 206);
  assert.deepEqual(restored.rawPayload, bytes.subarray(0, 16));
});

test('standalone writer loses ownership on a silent database partition and cannot revive', async (t) => {
  const f = await fixture(t, false);
  const bytes = Buffer.from('writer handover content');
  const id = await publish(f, bytes);
  await f.app.close();
  const proxy = await databaseProxy(f);
  const old = await createServer({ ...f.config, databaseUrl: proxy.url });
  f.cleanup.push(async () => {
    proxy.resume();
    await old.close();
  });
  assert.equal((await old.inject({ url: '/health/ready', headers: f.headers })).statusCode, 200);
  proxy.stall();
  await new Promise((resolve) => setTimeout(resolve, 8100));
  // This is local readiness: a silent TCP link must not keep the writer healthy indefinitely.
  assert.equal((await old.inject({ url: '/health/ready', headers: f.headers })).statusCode, 503);
  proxy.resume();
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal((await old.inject({ url: '/health/ready', headers: f.headers })).statusCode, 503);
  const next = await createServer(f.config);
  f.cleanup.push(() => next.close());
  const recovered = await next.inject({
    url: `${base}/artifacts/${id}/content`,
    headers: f.headers,
  });
  assert.equal(recovered.statusCode, 200);
  assert.deepEqual(recovered.rawPayload, bytes);
  const rejected = await old.inject({ method: 'POST', url: `${base}/uploads`, headers: f.headers });
  assert.equal(rejected.statusCode, 503);
});

test('terminated writer session permits a fresh owner and unsuccessful startup can be retried', async (t) => {
  const f = await fixture(t, false);
  const storageId = (await f.catalog.pool.query('SELECT storage_id FROM arkvory_storage_identity'))
    .rows[0].storage_id;
  const contender = new PostgresCatalog(f.config.databaseUrl, f.config.capacityBytes, 1);
  f.cleanup.push(() => contender.close());
  await assert.rejects(contender.claimStorage(storageId), { code: 'busy' });
  await assert.rejects(contender.claimStorage(storageId), { code: 'busy' });
  await f.catalog.pool.query(`SELECT pg_terminate_backend(pid) FROM pg_locks
    WHERE locktype='advisory' AND classid=18471 AND objid=3 AND objsubid=2 AND granted
    AND database=(SELECT oid FROM pg_database WHERE datname=current_database())`);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal((await f.app.inject({ url: '/health/ready', headers: f.headers })).statusCode, 503);
  const next = await createServer(f.config);
  f.cleanup.push(() => next.close());
  assert.equal((await next.inject({ url: '/health/ready', headers: f.headers })).statusCode, 200);
});
