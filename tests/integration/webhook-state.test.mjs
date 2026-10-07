import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebhookDelivery } from '@proanima/arkvory-application';
import {
  PostgresWebhookFeed,
  PostgresWebhookState,
  createEgressPolicy,
} from '@proanima/arkvory-infrastructure';
import { runWebhooks } from '../../apps/worker/dist/webhook-loop.js';
import { setup, create, base } from './fixture.mjs';
import { removeTestDirectory } from '../helpers.mjs';

const state = {
  subscription: 'ci',
  repository: 'releases',
  cursor: '9007199254740993',
  failures: 0,
  errorCode: null,
  errorAt: null,
  nextAttemptAt: null,
  deliveredAt: '2026-10-07T09:00:00.000Z',
  deliveredCount: 5,
};

test('a stale save never moves the cursor back for the same repository', async (t) => {
  const f = await setup(t);
  const store = new PostgresWebhookState(f.catalog.pool);
  await store.save(state);
  // A worker that lost ownership finishes a save from an older position: it is ignored, so the
  // successor does not repeat events it already delivered. 64-bit values compare as numbers.
  await store.save({ ...state, cursor: '9007199254740992', deliveredCount: 4 });
  await store.save({ ...state, cursor: '10', deliveredCount: 1 });
  assert.deepEqual(await store.load('ci'), state);

  // A failure at the same position is recorded: equal cursors are not stale.
  const failed = {
    ...state,
    failures: 1,
    errorCode: 'http_4xx',
    errorAt: '2026-10-07T10:00:00.000Z',
    nextAttemptAt: '2026-10-07T10:00:12.000Z',
  };
  await store.save(failed);
  assert.deepEqual(await store.load('ci'), failed);
  const ahead = { ...state, cursor: '9007199254740994', deliveredCount: 6 };
  await store.save(ahead);
  assert.deepEqual(await store.load('ci'), ahead);

  // Pointed at another repository, the subscription starts at that feed's head, lower or not.
  const moved = { ...state, repository: 'other', cursor: '3', deliveredCount: 0 };
  await store.save(moved);
  assert.deepEqual(await store.load('ci'), moved);
});

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
}

test('a worker that loses storage ownership stops before the next event of its page', async (t) => {
  const f = await setup(t);
  const directory = await mkdtemp(join(tmpdir(), 'arkvory-webhook-'));
  t.after(() => removeTestDirectory(directory));
  const secretFile = join(directory, 'secret');
  await writeFile(secretFile, 'integration-signing-secret-0001');
  let active = true;
  const received = [];
  const server = createServer((request, response) => {
    request.resume();
    request.on('end', () => {
      received.push(request.headers['x-arkvory-delivery']);
      // Ownership passes to another worker while this one is inside a page of three events.
      active = false;
      response.writeHead(204).end();
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const stop = new AbortController();
  t.after(() => stop.abort());
  const records = [];
  const catalog = {
    pool: f.catalog.pool,
    get active() {
      return active;
    },
  };
  const webhooks = [
    {
      id: 'ci',
      repository: 'releases',
      url: `http://127.0.0.1:${String(server.address().port)}/hook`,
      secretFile,
    },
  ];
  const states = new PostgresWebhookState(f.catalog.pool);
  // The subscription starts at the head of the feed, then three events wait in one page.
  await new WebhookDelivery({
    subscription: 'ci',
    repository: 'releases',
    feed: new PostgresWebhookFeed(f.catalog.pool),
    sender: { send: async () => assert.fail('nothing is sent on the first step') },
    states,
    now: () => new Date().toISOString(),
    random: () => 0.5,
  }).step({ throwIfAborted() {} });
  const head = (await states.load('ci')).cursor;
  for (const text of ['one', 'two', 'three']) await publish(f, text);
  await runWebhooks({
    catalog,
    webhooks,
    egress: createEgressPolicy([]),
    stop: stop.signal,
    diagnostics: { write: (record) => records.push(record) },
    pollMs: 10,
  });
  assert.equal(received.length, 1, 'no event after ownership was lost');
  // The answer came after ownership was lost: the position is the successor's to move, and it
  // repeats that event under the same id (at-least-once).
  assert.equal((await states.load('ci')).cursor, head);
  const [next] = (await new PostgresWebhookFeed(f.catalog.pool).changes('releases', head, 1)).items;
  assert.equal(received[0], `releases:${next.sequence}`);
  assert.deepEqual(
    records.map((record) => record.code),
    ['webhook.started', 'webhook.stopped'],
  );
});
