// The acknowledgment rule of an HA cluster (ADR 0072) against the real API and database, with a
// stand-in for the arkvory-replica helper on a local socket.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setup, create, base } from './fixture.mjs';

/** A helper whose answers the test sets: each request takes the next answer, then the last. */
async function helper(t) {
  const path =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\arkvory-replica-${randomUUID()}`
      : join(tmpdir(), `arkvory-replica-${randomUUID()}.sock`);
  const answers = [];
  let requests = 0;
  const server = createServer((request, response) => {
    requests++;
    const answer = answers.length > 1 ? answers.shift() : answers[0];
    if (answer === 'fail') {
      response.writeHead(500).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(answer));
  });
  server.listen(path);
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return {
    path,
    set: (...states) => {
      answers.length = 0;
      answers.push(...states);
    },
    get requests() {
      return requests;
    },
  };
}

const two = { copies: 2, required: 2, singleCopyUntil: null };
const one = { copies: 1, required: 2, singleCopyUntil: null };

test('a write is acknowledged only with enough complete copies, read after it completed', async (t) => {
  const replica = await helper(t);
  replica.set(two);
  const f = await setup(t, { replicaSocket: replica.path });

  // Both copies: the write is acknowledged.
  assert.equal((await create(f, Buffer.from('two copies'))).statusCode, 201);

  // One copy: refused before any work, in the API's envelope, with a time to retry.
  replica.set(one);
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const refused = await create(f, Buffer.from('one copy'));
  assert.equal(refused.statusCode, 503);
  assert.equal(refused.json().code, 'unavailable');
  assert.equal(refused.json().reason, 'replication_degraded');
  assert.ok(Number(refused.headers['retry-after']) > 0);
  // Reading goes on while copies are missing.
  const listing = await f.app.inject({
    method: 'GET',
    url: `${base}/artifacts`,
    headers: f.headers,
  });
  assert.equal(listing.statusCode, 200);
  // Readiness stays 200 (the node is healthy) and says writes are not acknowledged.
  const ready = await f.app.inject({ method: 'GET', url: '/health/ready', headers: f.headers });
  assert.equal(ready.statusCode, 200);
  assert.equal(ready.json().writable, false);
  assert.deepEqual(ready.json().replication, one);

  // A copy lost while the write ran: the write completed, its success is not sent; a retry with
  // the same idempotency key after the copy returned is acknowledged.
  const key = randomUUID();
  await new Promise((resolve) => setTimeout(resolve, 1100));
  replica.set(two, one);
  const lost = await create(f, Buffer.from('lost during the write'), key);
  assert.equal(lost.statusCode, 503);
  assert.equal(lost.json().reason, 'replication_degraded');
  replica.set(two);
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const retried = await create(f, Buffer.from('lost during the write'), key);
  assert.ok([200, 201].includes(retried.statusCode), String(retried.statusCode));

  // An unknown state refuses: the helper failing is not a reason to acknowledge.
  replica.set('fail');
  await new Promise((resolve) => setTimeout(resolve, 1100));
  assert.equal((await create(f, Buffer.from('unknown'))).statusCode, 503);

  // An operator's decision to accept one copy arrives as required = 1.
  replica.set({
    copies: 1,
    required: 1,
    singleCopyUntil: new Date(Date.now() + 3600e3).toISOString(),
  });
  await new Promise((resolve) => setTimeout(resolve, 1100));
  assert.equal((await create(f, Buffer.from('accepted single copy'))).statusCode, 201);
});

test('the registry refuses in its own format and sign-out still works when copies are missing', async (t) => {
  const replica = await helper(t);
  replica.set(one);
  const f = await setup(t, { replicaSocket: replica.path });
  const registry = await f.app.inject({
    method: 'POST',
    url: '/v2/releases/app/blobs/uploads/',
    headers: f.headers,
  });
  assert.equal(registry.statusCode, 503);
  assert.ok(Array.isArray(registry.json().errors), registry.body);
  // A session is not data: signing out is never refused for missing copies.
  const logout = await f.app.inject({
    method: 'POST',
    url: '/api/v1/auth/logout',
    headers: f.headers,
  });
  assert.notEqual(logout.statusCode, 503);
});

// A second server needs its own test: advisory locks are database-wide.
test('without a replica helper a standalone server acknowledges as before', async (t) => {
  const standalone = await setup(t);
  assert.equal((await create(standalone, Buffer.from('standalone'))).statusCode, 201);
  const ready = await standalone.app.inject({
    method: 'GET',
    url: '/health/ready',
    headers: standalone.headers,
  });
  assert.equal(ready.json().replication, undefined);
});
