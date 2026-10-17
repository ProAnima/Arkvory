import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { ArkvoryClient } from '@proanima/arkvory-sdk';

test('clientName becomes the Arkvory-Client header and is checked before any request', async (t) => {
  const seen = [];
  const server = createServer((request, response) => {
    seen.push({ client: request.headers['arkvory-client'], url: request.url });
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ items: [], next: null }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  await new ArkvoryClient(base, () => 'k', { clientName: 'arkvoryctl-mcp/1.0.0' }).searchAll({
    q: 'a b',
    repositories: ['r1', 'r2'],
    labels: ['x'],
    stage: 'qa',
    limit: 5,
  });
  await new ArkvoryClient(base, () => 'k').searchAll();
  assert.deepEqual(seen, [
    {
      client: 'arkvoryctl-mcp/1.0.0',
      url: '/api/v1/search?q=a+b&repositories=r1%2Cr2&labels=x&stage=qa&limit=5',
    },
    { client: undefined, url: '/api/v1/search' },
  ]);
  for (const clientName of ['', 'x'.repeat(65), 'tab\there', 'кириллица'])
    assert.throws(() => new ArkvoryClient(base, () => 'k', { clientName }), {
      code: 'invalid_argument',
    });
});
