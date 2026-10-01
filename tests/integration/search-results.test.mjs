import test from 'node:test';
import assert from 'node:assert/strict';
import { ArkvoryClient } from '@proanima/arkvory-sdk';
import { PostgresBrowse } from '@proanima/arkvory-infrastructure';
import { validateResponse } from '../api-schema.mjs';
import { setup, create, base } from './fixture.mjs';

const searchPath = '/api/v1/repositories/{repository}/search';

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
async function stage(f, id, name) {
  const response = await f.app.inject({
    method: 'PUT',
    url: `${base}/artifacts/${id}/stages/${name}`,
    headers: f.headers,
    payload: {},
  });
  assert.ok([200, 201].includes(response.statusCode), response.body);
}
async function search(f, query = '') {
  const response = await f.app.inject({ url: `${base}/search${query}`, headers: f.headers });
  assert.equal(response.statusCode, 200, response.body);
  validateResponse(searchPath, 'get', response);
  return response.json();
}

test('search items carry size, times, current labels and stages', async (t) => {
  const f = await setup(t);
  const plain = await publish(f, 'plain artifact');
  const staged = await publish(f, 'staged artifact');
  await stage(f, staged, 'qa');
  await stage(f, staged, 'prod');
  const client = new ArkvoryClient(await f.listen(), () => f.headers.authorization.slice(7));
  await client.annotate('releases', staged, 0, {
    labels: ['nightly'],
    metadata: {},
    collections: [],
  });
  const byId = new Map((await search(f)).items.map((item) => [item.id, item]));
  const original = byId.get(plain);
  assert.deepEqual(
    { ...original, createdAt: undefined, publishedAt: undefined },
    {
      id: plain,
      name: 'artifact.upack',
      size: String(Buffer.byteLength('plain artifact')),
      createdAt: undefined,
      publishedAt: undefined,
      labels: ['linux', 'release'],
      stages: [],
    },
  );
  assert.ok(Date.parse(original.createdAt) <= Date.parse(original.publishedAt));
  // Annotation labels replace descriptor labels; stages are listed in byte order.
  assert.deepEqual(byId.get(staged).labels, ['nightly']);
  assert.deepEqual(byId.get(staged).stages, ['prod', 'qa']);
  assert.deepEqual(
    (await search(f, '?label=nightly')).items.map((item) => item.id),
    [staged],
  );
  const page = await client.search('releases', { label: 'nightly' });
  assert.deepEqual(page, { items: [byId.get(staged)], next: null });
});

test('search keeps 64-bit sizes as decimal strings and reports a missing publication time', async (t) => {
  const f = await setup(t);
  const id = await publish(f, 'large');
  // Historical rows may predate publication timestamps; sizes beyond 2^32 must not lose digits.
  await f.catalog.pool.query(
    'UPDATE arkvory_uploads SET size=68719476736, published_at=NULL WHERE id=$1',
    [id],
  );
  const [item] = (await search(f)).items;
  assert.equal(item.size, '68719476736');
  assert.equal(item.publishedAt, null);
  const client = new ArkvoryClient(await f.listen(), () => f.headers.authorization.slice(7));
  assert.deepEqual((await client.search('releases')).items, [item]);
});

test('a search page of 100 with stages is one bounded statement', async (t) => {
  const f = await setup(t);
  // Seed 130 available artifacts directly; three stages each would multiply an N+1 lookup.
  await f.catalog.pool.query(
    `INSERT INTO arkvory_uploads(id,repository,owner,idempotency_key,descriptor,size,status,created_at,published_at)
     SELECT gen_random_uuid(),'releases','seed','seed-'||n,
            jsonb_build_object('name','seed-'||n||'.bin','size','1','sha256',repeat('a',64)),
            1,'available',now(),now()
     FROM generate_series(1,130) n`,
  );
  await f.catalog.pool.query(
    `INSERT INTO arkvory_artifact_stages(repository,artifact_id,stage,actor)
     SELECT 'releases',u.id,s.stage,'seed' FROM arkvory_uploads u
     CROSS JOIN (VALUES ('dev'),('qa'),('prod')) s(stage) WHERE u.owner='seed'`,
  );
  const statements = [];
  const browse = new PostgresBrowse({
    query: (sql, values) => {
      statements.push(sql);
      return f.catalog.pool.query(sql, values);
    },
  });
  const first = await browse.search('releases', '', '', '', undefined);
  assert.equal(statements.length, 1);
  assert.equal(first.length, 100);
  assert.ok(first.every((item) => item.stages.join() === 'dev,prod,qa'));
  const rest = await browse.search('releases', '', '', '', first.at(-1).id);
  assert.equal(statements.length, 2);
  assert.equal(rest.length, 30);
  assert.ok(rest[0].id > first.at(-1).id);
  const page = await search(f);
  assert.equal(page.items.length, 100);
  assert.equal(page.next, page.items.at(-1).id);
});
