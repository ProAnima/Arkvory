import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { PostgresIdentity } from '@proanima/arkvory-infrastructure';
import { RequestDrain, drainThenClose } from '../../apps/api/dist/drain.js';
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
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('health probes stay outside a saturated request budget', async (t) => {
  const f = await setup(t, { maxRequests: 4 });
  let release;
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  let entered = 0;
  const original = PostgresIdentity.prototype.resolve;
  PostgresIdentity.prototype.resolve = async () => {
    entered++;
    await blocked;
    return null;
  };
  const session = { authorization: `Bearer dps_${'a'.repeat(43)}` };
  const calls = Array.from({ length: 4 }, () =>
    f.app.inject({ url: '/api/v1/auth/me', headers: session }),
  );
  try {
    for (let attempts = 0; entered < 4 && attempts < 100; attempts++) await delay(10);
    assert.equal(entered, 4);
    const overflow = await f.app.inject({ url: '/api/v1/auth/me', headers: session });
    assert.equal(overflow.statusCode, 503);
    assert.equal(overflow.json().code, 'busy');
    const status = await f.app.inject({ url: '/health/status' });
    assert.equal(status.statusCode, 200);
    assert.deepEqual(status.json(), { status: 'ready' });
    const ready = await f.app.inject({ url: '/health/ready', headers: f.headers });
    assert.equal(ready.statusCode, 200, ready.body);
  } finally {
    release();
    await Promise.all(calls);
    PostgresIdentity.prototype.resolve = original;
  }
});

test('drain lets an in-flight download finish while new requests and readiness get 503', async (t) => {
  const drain = new RequestDrain();
  const f = await setup(t, { downloadBytesPerSecond: 65536 }, { drain });
  const bytes = Buffer.alloc(256 * 1024, 0x42),
    id = await publish(f, bytes);
  const address = await f.listen();
  const url = `${address}${base}/artifacts/${id}/content`;
  // About four seconds at 64 KiB/s: the stream is still running when the drain starts.
  const running = await fetch(url, { headers: f.headers });
  assert.equal(running.status, 200);
  const body = running.arrayBuffer();
  const closed = drainThenClose(f.app, drain, 30000);
  const rejected = await fetch(url, { headers: f.headers });
  assert.equal(rejected.status, 503);
  assert.equal((await rejected.json()).code, 'busy');
  assert.equal(rejected.headers.get('retry-after'), '2');
  const status = await fetch(`${address}/health/status`);
  assert.equal(status.status, 503);
  assert.deepEqual(await status.json(), { status: 'draining' });
  const ready = await fetch(`${address}/health/ready`, { headers: f.headers });
  assert.equal(ready.status, 503);
  assert.equal(sha256(Buffer.from(await body)), sha256(bytes), 'drained stream is complete');
  assert.equal(await closed, true, 'every admitted response finished inside the window');
});

test('drain timeout closes a transfer that cannot finish in the window', async (t) => {
  const drain = new RequestDrain();
  const f = await setup(t, { downloadBytesPerSecond: 65536 }, { drain });
  const id = await publish(f, Buffer.alloc(1024 * 1024, 0x43));
  const address = await f.listen();
  const running = await fetch(`${address}${base}/artifacts/${id}/content`, {
    headers: f.headers,
  });
  assert.equal(running.status, 200);
  // Observe the outcome now: the connection is destroyed while drainThenClose is awaited.
  const body = running.arrayBuffer().then(
    () => 'completed',
    () => 'interrupted',
  );
  const started = performance.now();
  assert.equal(await drainThenClose(f.app, drain, 300), false);
  assert.ok(performance.now() - started < 10000, 'close does not wait for the full transfer');
  assert.equal(await body, 'interrupted');
});
