import test from 'node:test';
import assert from 'node:assert/strict';
import { ArkvoryClient } from '@proanima/arkvory-sdk';
import { setup, create, base } from './fixture.mjs';

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

const changes = async (f, query = '', headers = f.readerHeaders) => {
  const response = await f.app.inject({ url: `${base}/changes${query}`, headers });
  assert.equal(response.statusCode, 200, response.body);
  return response.json();
};

test('the change feed lists publications, annotations, paths and stages in commit order', async (t) => {
  const f = await setup(t);
  assert.deepEqual(await changes(f), { items: [], head: '0', next: null });
  const first = await publish(f, 'first');
  const second = await publish(f, 'second');
  const change = (method, url, payload) =>
    f.app.inject({ method, url: `${base}${url}`, headers: f.headers, payload });
  const annotated = await change('PUT', `/artifacts/${first}/annotations`, {
    expectedRevision: 0,
    value: { labels: ['ci'], metadata: {}, collections: [] },
  });
  assert.equal(annotated.statusCode, 200, annotated.body);
  const asset = await change('PUT', '/asset', {
    path: 'tools/setup.exe',
    artifactId: second,
    expectedRevision: 0,
  });
  assert.equal(asset.statusCode, 200, asset.body);
  assert.equal((await change('PUT', `/artifacts/${first}/stages/qa`, {})).statusCode, 200);
  assert.equal((await change('DELETE', `/artifacts/${first}/stages/qa`)).statusCode, 204);
  // A repeated idempotent publication does not enter the feed again.
  const repeated = await f.app.inject({
    method: 'POST',
    url: `${base}/uploads/${first}/complete`,
    headers: f.headers,
  });
  assert.equal(repeated.statusCode, 200, repeated.body);

  const page = await changes(f);
  assert.deepEqual(
    page.items.map(({ action, artifactId, detail }) => [action, artifactId, detail]),
    [
      ['artifact.publish', first, null],
      ['artifact.publish', second, null],
      ['annotations.replace', first, null],
      ['asset.replace', second, 'tools/setup.exe'],
      ['stage.add', first, 'qa'],
      ['stage.remove', first, 'qa'],
    ],
  );
  const sequences = page.items.map((item) => BigInt(item.sequence));
  assert.deepEqual(
    sequences,
    [...sequences].sort((a, b) => (a < b ? -1 : 1)),
  );
  assert.equal(page.head, page.items.at(-1).sequence);
  assert.equal(page.next, null);
  assert.ok(
    page.items.every((item) => !('actor' in item)),
    'the feed carries no actors',
  );

  // Pages follow `next`; the same cursor always gives the same continuation.
  const firstPage = await changes(f, '?limit=4');
  assert.equal(firstPage.items.length, 4);
  assert.equal(firstPage.next, firstPage.items.at(-1).sequence);
  const rest = await changes(f, `?after=${firstPage.next}&limit=4`);
  assert.deepEqual(
    [...firstPage.items, ...rest.items].map((item) => item.sequence),
    page.items.map((item) => item.sequence),
  );
  assert.equal(rest.next, null);
  // The SDK reads the same pages with a read-only key and validates them.
  const client = new ArkvoryClient(await f.listen(), () => f.readerHeaders.authorization.slice(7));
  assert.deepEqual(await client.catalogChanges('releases', { limit: 4 }), firstPage);
});

test('the feed needs only list access, and rejects malformed cursors with field details', async (t) => {
  const f = await setup(t);
  await publish(f, 'readable');
  assert.equal((await changes(f)).items.length, 1, 'a read-only key follows the feed');
  // The audit journal with its actors stays a write-scope operation.
  const audit = await f.app.inject({ url: `${base}/audit`, headers: f.readerHeaders });
  assert.equal(audit.statusCode, 403);
  for (const [query, field] of [
    ['?after=-1', 'after'],
    ['?after=1e3', 'after'],
    ['?limit=0', 'limit'],
    ['?limit=101', 'limit'],
  ]) {
    const response = await f.app.inject({ url: `${base}/changes${query}`, headers: f.headers });
    assert.equal(response.statusCode, 400, query);
    assert.equal(response.json().details?.[0]?.field, field, query);
  }
  const unknown = await f.app.inject({ url: `${base}/changes?since=1`, headers: f.headers });
  assert.equal(unknown.statusCode, 400);
  const other = await f.app.inject({
    url: '/api/v1/repositories/elsewhere/changes',
    headers: f.readerHeaders,
  });
  assert.equal(other.statusCode, 403, 'no feed of a repository outside the key scope');
});
