import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebhookDelivery } from '@proanima/arkvory-application';
import {
  HttpWebhookSender,
  PostgresWebhookFeed,
  PostgresWebhookState,
  createEgressPolicy,
  readWebhookSecrets,
  verifyWebhook,
} from '@proanima/arkvory-infrastructure';
import { setup, create, base } from './fixture.mjs';

const live = { throwIfAborted() {} };

async function publish(f, text) {
  const bytes = Buffer.from(text);
  const id = (await create(f, bytes)).json().id;
  const stored = await f.app.inject({
    method: 'PUT',
    url: `${base}/uploads/${id}/content`,
    headers: { ...f.headers, 'content-type': 'application/octet-stream' },
    payload: bytes,
  });
  assert.equal(stored.statusCode, 200, stored.body);
  return id;
}

async function receiver(t, answer) {
  const requests = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      requests.push({ headers: request.headers, body: Buffer.concat(chunks).toString('utf8') });
      response.writeHead(answer());
      response.end();
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return { requests, port: server.address().port };
}

async function subscription(t, f, url, clock) {
  const directory = await mkdtemp(join(tmpdir(), 'arkvory-webhook-'));
  const secretFile = join(directory, 'secret');
  const secret = 'integration-signing-secret-0001';
  await writeFile(secretFile, secret);
  const pool = f.catalog.pool;
  const make = () =>
    new WebhookDelivery({
      subscription: 'ci',
      repository: 'releases',
      feed: new PostgresWebhookFeed(pool),
      sender: new HttpWebhookSender({
        url,
        policy: createEgressPolicy([]),
        secrets: () => readWebhookSecrets([secretFile]),
        nowSeconds: () => Math.floor(clock.now / 1000),
      }),
      states: new PostgresWebhookState(pool),
      now: () => new Date(clock.now).toISOString(),
      random: () => 0.5,
    });
  return { secret, make, states: new PostgresWebhookState(pool) };
}

test('publications reach the receiver in journal order, once, and a down receiver loses nothing', async (t) => {
  const f = await setup(t);
  let answer = 204;
  const r = await receiver(t, () => answer);
  const clock = { now: Date.parse('2026-10-07T10:00:00Z') };
  const hook = await subscription(t, f, `http://127.0.0.1:${r.port}/hook`, clock);
  const delivery = hook.make();

  // History before the subscription is not delivered; the first step only records the head.
  await publish(f, 'before');
  assert.equal(await delivery.step(live), 'idle');
  assert.equal(r.requests.length, 0);

  const second = await publish(f, 'second');
  const third = await publish(f, 'third');
  assert.equal(await delivery.step(live), 'delivered');
  assert.deepEqual(
    r.requests.map((request) => JSON.parse(request.body).artifactId),
    [second, third],
  );
  for (const request of r.requests) {
    const event = JSON.parse(request.body);
    assert.equal(event.repository, 'releases');
    assert.equal(event.action, 'artifact.publish');
    assert.equal(request.headers['x-arkvory-delivery'], event.id);
    assert.match(event.id, /^releases:[0-9]+$/);
    assert.ok(!('actor' in event), 'no author in an event');
    assert.equal(
      verifyWebhook({
        secrets: [hook.secret],
        timestamp: request.headers['x-arkvory-timestamp'],
        signature: request.headers['x-arkvory-signature'],
        body: request.body,
        nowSeconds: Math.floor(clock.now / 1000),
      }),
      true,
    );
  }
  assert.equal(await delivery.step(live), 'idle', 'nothing is delivered twice');

  // The receiver goes down: the event waits, the failure is on record and in the metrics.
  answer = 503;
  const fourth = await publish(f, 'fourth');
  assert.equal(await delivery.step(live), 'failed');
  const failed = await hook.states.load('ci');
  assert.equal(failed.errorCode, 'http_5xx');
  assert.equal(failed.failures, 1);
  const metrics = (await f.app.inject({ url: '/health/metrics', headers: f.headers })).body;
  assert.match(metrics, /arkvory_webhook_failing\{[^}]*subscription="ci"[^}]*\} 1/);
  assert.ok(!metrics.includes('127.0.0.1:'), 'no receiver address in metrics');

  // A new worker process (new objects, same database) still respects the backoff.
  const restarted = hook.make();
  assert.equal(await restarted.step(live), 'idle');
  const attempts = r.requests.length;

  // The receiver is back after the backoff: the same event arrives, under the same id.
  answer = 204;
  clock.now += 3_700_000;
  assert.equal(await restarted.step(live), 'delivered');
  assert.equal(r.requests.length, attempts + 1);
  assert.equal(JSON.parse(r.requests.at(-1).body).artifactId, fourth);
  const healthy = await hook.states.load('ci');
  assert.equal(healthy.failures, 0);
  assert.equal(healthy.errorCode, null);
  assert.equal(healthy.deliveredCount, 3);
  assert.equal(await restarted.step(live), 'idle');
});

test('an unreachable receiver never delays an upload or the journal', async (t) => {
  const f = await setup(t);
  const clock = { now: Date.now() };
  // Nothing listens on this port: every delivery fails while the catalog keeps working.
  const dead = createServer();
  await new Promise((resolve) => dead.listen(0, '127.0.0.1', resolve));
  const port = dead.address().port;
  await new Promise((resolve) => dead.close(resolve));
  const hook = await subscription(t, f, `http://127.0.0.1:${port}/hook`, clock);
  const delivery = hook.make();
  await delivery.step(live);
  const started = Date.now();
  await publish(f, 'one');
  await publish(f, 'two');
  assert.ok(Date.now() - started < 5000, 'publishing does not wait for a receiver');
  assert.equal(await delivery.step(live), 'failed');
  const state = await hook.states.load('ci');
  assert.equal(state.errorCode, 'network');
  // The feed still lists both events for a consumer that polls it.
  const feed = await f.app.inject({ url: `${base}/changes`, headers: f.readerHeaders });
  assert.equal(feed.json().items.length, 2);
});

test('subscription state is stored per subscription and survives a restart of the database pool', async (t) => {
  const f = await setup(t);
  const store = new PostgresWebhookState(f.catalog.pool);
  assert.equal(await store.load('ci'), null);
  const state = {
    subscription: 'ci',
    repository: 'releases',
    cursor: '9007199254740993',
    failures: 2,
    errorCode: 'timeout',
    errorAt: '2026-10-07T10:00:00.000Z',
    nextAttemptAt: '2026-10-07T10:00:24.000Z',
    deliveredAt: '2026-10-07T09:00:00.000Z',
    deliveredCount: 5,
  };
  await store.save(state);
  await store.save({ ...state, subscription: 'deploy', cursor: '3' });
  assert.deepEqual(await store.load('ci'), state, 'a 64-bit cursor keeps every digit');
  assert.deepEqual(
    (await store.all()).map((row) => row.subscription),
    ['ci', 'deploy'],
  );
  await store.save({ ...state, failures: 0, errorCode: null, errorAt: null, nextAttemptAt: null });
  assert.equal((await store.load('ci')).errorCode, null);

  // A removed subscription is forgotten, so that it leaves no stale metric or alert behind.
  await store.prune(['ci']);
  assert.deepEqual(
    (await store.all()).map((row) => row.subscription),
    ['ci'],
  );
  await store.prune([]);
  assert.deepEqual(await store.all(), []);
});
