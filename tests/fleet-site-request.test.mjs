import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { FleetFailure, siteRequest } from '@proanima/arkvory-infrastructure';

test('an aborted site request ends at once and closes its connection', async (t) => {
  // A site that takes the request and never answers.
  const closed = [];
  const server = createServer((request) => {
    request.socket.once('close', () => closed.push(true));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const { port } = server.address();
  const endpoint = { url: `http://127.0.0.1:${port}`, pin: null, certificate: null };
  const caller = new AbortController();
  const pending = siteRequest(endpoint, 'GET', '/api/v1/repositories', {
    signal: caller.signal,
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const started = Date.now();
  caller.abort();
  await assert.rejects(
    pending,
    (error) => error instanceof FleetFailure && error.code === 'unreachable',
  );
  assert.ok(Date.now() - started < 1000);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(closed, [true]);
  // An already aborted signal sends nothing.
  await assert.rejects(
    siteRequest(endpoint, 'GET', '/api/v1/repositories', { signal: caller.signal }),
    (error) => error instanceof FleetFailure && error.code === 'unreachable',
  );
  assert.deepEqual(closed, [true]);
});
