import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { ArkvoryClient } from '@proanima/arkvory-sdk';
import { validateResponse } from '../api-schema.mjs';
import { setup, descriptor } from './fixture.mjs';

const reader = 'search-' + randomUUID() + randomUUID();
const keys = (writer) => [
  {
    sha256: createHash('sha256').update(writer).digest('hex'),
    principal: {
      id: 'search-writer',
      repositories: ['releases', 'archive', 'hidden'],
      permissions: ['read', 'write'],
    },
  },
  {
    sha256: createHash('sha256').update(reader).digest('hex'),
    principal: {
      id: 'search-reader',
      repositories: ['releases', 'archive'],
      permissions: ['read'],
    },
  },
];

async function publish(f, headers, repository, text, labels = ['release']) {
  const bytes = Buffer.from(text);
  const created = await f.app.inject({
    method: 'POST',
    url: `/api/v1/repositories/${repository}/uploads`,
    headers: { ...headers, 'idempotency-key': randomUUID() },
    payload: { ...descriptor(bytes), name: `${text}.bin`, labels, metadata: { build: text } },
  });
  assert.equal(created.statusCode, 201, created.body);
  const id = created.json().id;
  const stored = await f.app.inject({
    method: 'PUT',
    url: `/api/v1/repositories/${repository}/uploads/${id}/content`,
    headers: { ...headers, 'content-type': 'application/octet-stream' },
    payload: bytes,
  });
  assert.equal(stored.statusCode, 200, stored.body);
  return id;
}

test('installation-wide search: ACL, no existence oracle, filters and keyset pages', async (t) => {
  const writer = 'search-writer-' + randomUUID() + randomUUID();
  const f = await setup(t, { keys: keys(writer) });
  const own = { authorization: `Bearer ${writer}` };
  const theirs = { authorization: `Bearer ${reader}` };
  const ids = {};
  for (const [repository, name] of [
    ['releases', 'alpha'],
    ['releases', 'beta'],
    ['archive', 'gamma'],
    ['archive', 'delta'],
    ['hidden', 'secret'],
  ])
    ids[name] = await publish(
      f,
      own,
      repository,
      name,
      name === 'beta' ? ['nightly'] : ['release'],
    );
  // Equal publication times across repositories exercise the (repository, id) tie-break.
  await f.catalog.pool.query(
    `UPDATE arkvory_uploads SET published_at = '2026-05-01T10:00:00.123456Z' WHERE id = ANY($1::uuid[])`,
    [[ids.alpha, ids.gamma, ids.delta]],
  );
  await f.catalog.pool.query(
    `UPDATE arkvory_uploads SET published_at = '2026-06-01T00:00:00Z' WHERE id = $1`,
    [ids.beta],
  );
  const stage = await f.app.inject({
    method: 'PUT',
    url: `/api/v1/repositories/archive/artifacts/${ids.gamma}/stages/qa`,
    headers: own,
    payload: {},
  });
  assert.ok([200, 201].includes(stage.statusCode), stage.body);

  const search = async (query, headers = theirs) => {
    const response = await f.app.inject({ url: `/api/v1/search${query}`, headers });
    assert.equal(response.statusCode, 200, response.body);
    validateResponse('/api/v1/search', 'get', response);
    return response.json();
  };
  const all = await search('');
  const names = all.items.map((item) => item.name);
  assert.equal(names.includes('secret.bin'), false, 'unreadable repository never searched');
  assert.equal(names[0], 'beta.bin', 'newest publication first');
  const tied = all.items.filter((item) => item.publishedAt === '2026-05-01T10:00:00.123Z');
  const order = (a, b) =>
    a.repository < b.repository ? -1 : a.repository > b.repository ? 1 : a.id < b.id ? -1 : 1;
  assert.deepEqual(tied, [...tied].sort(order));
  assert.equal(tied.length, 3);
  assert.equal(all.next, null);

  // Hidden and absent repositories are indistinguishable; the writer finds the hidden one.
  assert.deepEqual(await search('?repositories=hidden'), { items: [], next: null });
  assert.deepEqual(await search('?repositories=does-not-exist'), { items: [], next: null });
  assert.equal((await search('?repositories=hidden', own)).items[0].id, ids.secret);
  assert.deepEqual(
    (await search('?repositories=archive,hidden')).items.map((i) => i.repository),
    ['archive', 'archive'],
  );

  assert.deepEqual(
    (await search('?labels=nightly')).items.map((i) => i.id),
    [ids.beta],
  );
  assert.deepEqual(
    (await search('?stage=qa')).items.map((i) => [i.id, i.stages]),
    [[ids.gamma, ['qa']]],
  );
  assert.deepEqual(
    (await search('?q=DELT')).items.map((i) => i.id),
    [ids.delta],
  );

  // Pages of one follow exactly the single-page order, ties included, and end with null.
  const walked = [];
  let after = '';
  for (let pages = 0; pages < 10; pages++) {
    const page = await search(`?limit=1${after ? `&after=${encodeURIComponent(after)}` : ''}`);
    walked.push(...page.items.map((i) => i.id));
    if (page.next === null) break;
    after = page.next;
  }
  assert.deepEqual(
    walked,
    all.items.map((i) => i.id),
  );

  const invalid = await f.app.inject({ url: '/api/v1/search?after=forged', headers: theirs });
  assert.equal(invalid.statusCode, 400);
  assert.deepEqual(invalid.json().details, [{ field: 'after', problem: 'format' }]);
  // Values PostgreSQL would reject (bigint and timestamp range, NUL in text) are input errors.
  for (const [query, field] of [
    [`after=9999999999999999999.archive.${ids.gamma}`, 'after'],
    [`after=9223372036854775807.archive.${ids.gamma}`, 'after'],
    ['q=a%00b', 'q'],
  ]) {
    const refused = await f.app.inject({ url: `/api/v1/search?${query}`, headers: theirs });
    assert.equal(refused.statusCode, 400, `${query}: ${refused.body}`);
    assert.deepEqual(refused.json().details, [{ field, problem: 'format' }]);
  }

  const client = new ArkvoryClient(await f.listen(), () => reader, {
    clientName: 'arkvoryctl-mcp/test',
  });
  const viaSdk = await client.searchAll({ repositories: ['archive'], limit: 1 });
  assert.equal(viaSdk.items.length, 1);
  assert.equal(viaSdk.items[0].repository, 'archive');
  assert.ok(viaSdk.next);
});
