import test from 'node:test';
import assert from 'node:assert/strict';
import { ArkvoryClient } from '@proanima/arkvory-sdk';
import { setup, create, base } from './fixture.mjs';

test('search uses current metadata, literal substrings, exact pairs and existing scope/cursor filters', async (t) => {
  const f = await setup(t),
    bytes = Buffer.from('search'),
    id = (await create(f, bytes)).json().id;
  assert.equal(
    (
      await f.app.inject({
        method: 'PUT',
        url: `${base}/uploads/${id}/content`,
        headers: { ...f.headers, 'content-type': 'application/octet-stream' },
        payload: bytes,
      })
    ).statusCode,
    200,
  );
  const client = new ArkvoryClient(await f.listen(), () => f.headers.authorization.slice(7));
  assert.equal((await client.search('releases', { q: '1.0' })).items[0].id, id);
  await client.annotate('releases', id, 0, {
    labels: ['test'],
    metadata: { commit: 'Revision-A', literal: '%_needle', empty: '', target: 'Сборка' },
    collections: ['ci'],
  });
  assert.equal((await client.search('releases', { q: '1.0' })).items.length, 0);
  assert.equal(
    (await client.search('releases', { q: 'revision-a', label: 'test', collection: 'ci' })).items[0]
      .id,
    id,
  );
  assert.equal(
    (await client.search('releases', { q: 'revision-a', label: 'release' })).items.length,
    0,
  );
  assert.equal((await client.search('releases', { q: '%_' })).items[0].id, id);
  assert.equal(
    (await client.search('releases', { metadataKey: 'empty', metadataValue: '' })).items[0].id,
    id,
  );
  assert.equal(
    (await client.search('releases', { metadataKey: 'target', metadataValue: 'Сборка' })).items[0]
      .id,
    id,
  );
  assert.equal(
    (await client.search('releases', { metadataKey: 'commit', metadataValue: 'revision-a' })).items
      .length,
    0,
  );
  assert.equal((await client.search('releases', { q: 'revision-a', after: id })).items.length, 0);
  for (const query of [
    'metadataKey=commit',
    'metadataValue=x',
    'metadataKey=constructor&metadataValue=x',
    `metadataKey=commit&metadataValue=${'a'.repeat(1025)}`,
  ])
    assert.equal(
      (await f.app.inject({ url: `${base}/search?${query}`, headers: f.headers })).statusCode,
      400,
    );
  assert.equal(
    (
      await f.app.inject({
        url: '/api/v1/repositories/other/search?q=revision-a',
        headers: f.headers,
      })
    ).statusCode,
    403,
  );
  await client.annotate('releases', id, 1, { labels: [], metadata: {}, collections: [] });
  assert.equal((await client.search('releases', { q: 'revision-a' })).items.length, 0);
  assert.equal((await client.search('releases', { q: '1.0' })).items.length, 0);
});
