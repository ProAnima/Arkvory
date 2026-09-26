import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { ArkvoryClient } from '@proanima/arkvory-sdk';
import { migrate, PostgresBrowse } from '@proanima/arkvory-infrastructure';
import { validateResponse } from '../api-schema.mjs';
import { setup, base } from './fixture.mjs';

async function seed(f, paths, repository = 'releases') {
  const id = randomUUID();
  await f.catalog.pool.query(
    `INSERT INTO arkvory_uploads(id,repository,owner,idempotency_key,descriptor,size,status,created_at)
    VALUES($1::uuid,$2,'asset-page-test',$1::text,$3,0,'available',now())`,
    [
      id,
      repository,
      JSON.stringify({ name: 'seed', size: '0', sha256: '0'.repeat(64), labels: [], metadata: {} }),
    ],
  );
  await f.catalog.pool.query(
    'INSERT INTO arkvory_assets(repository,path,revision,artifact_id) SELECT $1,path,1,$2 FROM unnest($3::text[]) AS path',
    [repository, id, paths],
  );
  return id;
}
async function page(f, options = {}, headers = f.headers, repoBase = base) {
  return f.app.inject({ url: `${repoBase}/assets/page?${new URLSearchParams(options)}`, headers });
}
function value(response) {
  assert.equal(response.statusCode, 200, response.body);
  validateResponse('/api/v1/repositories/{repository}/assets/page', 'get', response);
  return response.json();
}

test('asset cursor pages traverse beyond 1000 through HTTP and SDK while the original list stays compatible', async (t) => {
  const f = await setup(t);
  const paths = Array.from({ length: 1105 }, (_, i) => `build/${String(i).padStart(5, '0')}.zip`);
  await seed(f, paths);
  const url = await f.listen(),
    client = new ArkvoryClient(url, () => f.headers.authorization.slice(7));
  assert.equal((await client.capabilities()).features.assetPagination, true);
  assert.equal((await client.assetPage('releases')).items.length, 50);
  const seen = [];
  let after;
  do {
    const result = await client.assetPage('releases', {
      prefix: 'build/',
      limit: 73,
      ...(after ? { after } : {}),
    });
    seen.push(...result.items.map((v) => v.path));
    after = result.next;
    assert.ok(seen.length <= paths.length);
  } while (after);
  assert.deepEqual(seen, paths);
  assert.deepEqual(value(await page(f, { prefix: 'absent/' })), { items: [], next: null });
  const end = value(await page(f, { prefix: 'build/01104', limit: '1' }));
  assert.equal(end.items.length, 1);
  assert.equal(end.next, null);
  assert.equal((await f.app.inject({ url: `${base}/assets`, headers: f.headers })).statusCode, 400);
  const old = await f.app.inject({ url: `${base}/assets?prefix=build/01104`, headers: f.headers });
  assert.deepEqual(Object.keys(old.json()), ['items']);
  assert.deepEqual(old.json().items, end.items);
  const head = await f.app.inject({
    method: 'HEAD',
    url: `${base}/assets/page`,
    headers: f.headers,
  });
  assert.equal(head.statusCode, 200);
  assert.equal(head.body, '');
  assert.match(head.headers['cache-control'], /no-store/);
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(client.assetPage('releases', {}, aborted.signal));
});

test('asset prefix is literal and case-sensitive; byte ordering handles non-ASCII and scalar boundaries', async (t) => {
  const f = await setup(t);
  const paths = [
    'x/a',
    'x/A',
    'x/Я',
    'x/я',
    'x/é',
    'x/e\u0301',
    'x/\ue000',
    'x/😀',
    'x/%/one',
    'x/_/one',
    "x/' OR 1=1--",
    'x/prefix',
    'x/prefix/deep',
    'x/prefix2',
    'x/\ud7ff',
    'x/\u{10ffff}',
    '\u{10ffff}/a',
    '\u{10ffff}/b',
  ];
  await seed(f, paths);
  for (const prefix of [
    '',
    'x/',
    'x/%',
    'x/_',
    "x/' OR 1=1--",
    'x/a',
    'x/prefix',
    'x/prefix/',
    'x/\ud7ff',
    'x/\u{10ffff}',
    '\u{10ffff}',
  ]) {
    const expected = paths
      .filter((p) => p.startsWith(prefix))
      .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
    const seen = [];
    let after;
    do {
      const result = value(await page(f, { prefix, limit: '1', ...(after ? { after } : {}) }));
      seen.push(...result.items.map((v) => v.path));
      after = result.next;
      assert.ok(seen.length <= expected.length);
    } while (after);
    assert.deepEqual(seen, expected);
  }
});

test('asset page validation binds cursors to filters and repositories and rejects malformed query input', async (t) => {
  const f = await setup(t);
  f.config.keys[0].principal.repositories.push('other');
  await seed(f, ['a/1', 'a/2']);
  await seed(f, ['a/1', 'a/2'], 'other');
  const first = value(await page(f, { prefix: 'a/', limit: '1' }));
  for (const options of [
    { after: first.next },
    { prefix: 'a/', after: '!' },
    { prefix: 'a/', after: first.next + '=' },
    { prefix: 'a/', after: 'a'.repeat(8193) },
    { prefix: 'a/', after: Buffer.from('null').toString('base64url') },
    { prefix: 'a/', after: '' },
    { prefix: 'x'.repeat(1025) },
    { prefix: 'a\0' },
    { prefix: 'a\n' },
    { unknown: 'x' },
    ...['0', '101', '-1', '1.1', '1e2', '01'].map((limit) => ({ limit })),
  ])
    assert.equal((await page(f, options)).statusCode, 400, JSON.stringify(options));
  assert.equal(
    (await page(f, { prefix: 'a/', after: first.next }, f.headers, '/api/v1/repositories/other'))
      .statusCode,
    400,
  );
  const data = JSON.parse(Buffer.from(first.next, 'base64url').toString('utf8'));
  for (const mutation of [
    { ...data, v: 2 },
    { ...data, path: 'outside' },
    { ...data, path: 'a/..' },
    { ...data, path: 'a/\ud800' },
    { ...data, unexpected: true },
  ])
    assert.equal(
      (
        await page(f, {
          prefix: 'a/',
          after: Buffer.from(JSON.stringify(mutation)).toString('base64url'),
        })
      ).statusCode,
      400,
    );
  assert.equal(
    (await f.app.inject({ url: `${base}/assets/page?limit=1&limit=2`, headers: f.headers }))
      .statusCode,
    400,
  );
  const changedLimit = value(await page(f, { prefix: 'a/', after: first.next, limit: '100' }));
  assert.deepEqual(
    changedLimit.items.map((v) => v.path),
    ['a/2'],
  );
});

test('asset cursors grant no authority; managed permissions and revocation are checked on every page', async (t) => {
  const f = await setup(t);
  f.config.keys[0].principal.serviceAdministrator = true;
  await seed(f, ['a', 'b']);
  const url = await f.listen(),
    root = new ArkvoryClient(url, () => f.headers.authorization.slice(7));
  const bindings = [{ resource: { kind: 'repository', id: 'releases' }, actions: ['asset.read'] }];
  const account = await root.createServiceAccount('asset-reader', bindings);
  const issued = await root.issueServiceKey(account.id, 'asset-reader', {
    name: 'reader-key',
    bindings,
  });
  const client = new ArkvoryClient(url, () => issued.secret);
  await client.activateServiceKey();
  const first = await client.assetPage('releases', { limit: 1 });
  await root.setServicePolicy(account.id, 1, []);
  await assert.rejects(client.assetPage('releases', { after: first.next }), { status: 403 });
  await root.setServicePolicy(account.id, 2, bindings);
  assert.deepEqual(
    (await client.assetPage('releases', { after: first.next })).items.map((v) => v.path),
    ['b'],
  );
  await assert.rejects(client.assetPage('other', { after: first.next }), { status: 403 });
  await root.revokeServiceKey(issued.key.id);
  await assert.rejects(client.assetPage('releases', { after: first.next }), { status: 401 });
  assert.equal((await page(f, {}, {})).statusCode, 401);
  f.config.keys[1].principal.permissions = ['write'];
  assert.equal((await page(f, { after: first.next }, f.readerHeaders)).statusCode, 403);
});

test('asset cursor survives restart and mutable pointers without offset duplicates; pages are not a snapshot', async (t) => {
  const f = await setup(t);
  const id = await seed(f, ['b', 'd', 'f']);
  const first = value(await page(f, { limit: '1' }));
  await f.catalog.pool.query(
    'INSERT INTO arkvory_assets(repository,path,revision,artifact_id) VALUES($1,$2,1,$4),($1,$3,1,$4)',
    ['releases', 'a', 'c', id],
  );
  await f.catalog.pool.query(
    'UPDATE arkvory_assets SET revision=2 WHERE repository=$1 AND path=$2',
    ['releases', 'd'],
  );
  await f.restart();
  const second = value(await page(f, { limit: '2', after: first.next }));
  assert.deepEqual(
    second.items.map((v) => [v.path, v.revision]),
    [
      ['c', 1],
      ['d', 2],
    ],
  );
  await f.catalog.pool.query('DELETE FROM arkvory_assets WHERE repository=$1 AND path=$2', [
    'releases',
    'd',
  ]);
  assert.deepEqual(
    value(await page(f, { after: second.next })).items.map((v) => v.path),
    ['f'],
  );
});

test('asset page uses a bounded index seek even for a narrow prefix near the end of a large repository', async (t) => {
  const f = await setup(t);
  await seed(
    f,
    Array.from({ length: 20000 }, (_, i) => `folder/${String(i).padStart(6, '0')}`),
  );
  await f.catalog.pool.query('ANALYZE arkvory_assets');
  let query, params;
  const browse = new PostgresBrowse({
    query: async (sql, values) => {
      query = sql;
      params = values;
      return f.catalog.pool.query(sql, values);
    },
  });
  const first = await browse.assetPage('releases', { prefix: 'folder/019', limit: 23 });
  const next = await browse.assetPage('releases', {
    prefix: 'folder/019',
    limit: 23,
    after: first.next,
  });
  assert.equal(next.items.length, 23);
  const plan = (await f.catalog.pool.query('EXPLAIN (ANALYZE, FORMAT JSON) ' + query, params))
    .rows[0]['QUERY PLAN'][0].Plan;
  const nodes = [];
  const visit = (n) => {
    nodes.push(n);
    for (const child of n.Plans ?? []) visit(child);
  };
  visit(plan);
  assert.ok(
    nodes.some((n) => n['Index Name'] === 'arkvory_asset_page_path'),
    JSON.stringify(plan),
  );
  assert.equal(
    nodes.some((n) => ['Sort', 'Seq Scan'].includes(n['Node Type'])),
    false,
    JSON.stringify(plan),
  );
  assert.ok(
    nodes.every((n) => (n['Actual Rows'] ?? 0) <= 24),
    JSON.stringify(plan),
  );
  assert.ok(
    nodes.every((n) => (n['Rows Removed by Filter'] ?? 0) === 0),
    JSON.stringify(plan),
  );
});

test('asset index migration upgrades an existing catalog, resumes a completed index and keeps readiness closed until marked', async (t) => {
  const f = await setup(t);
  const id = await seed(f, ['existing/file']);
  await f.catalog.pool.query('DELETE FROM arkvory_migrations WHERE version=11');
  await f.catalog.pool.query('DROP INDEX arkvory_asset_page_path');
  await assert.rejects(f.catalog.ready(), { code: 'unavailable' });
  const held = await f.catalog.pool.connect();
  await held.query('SELECT pg_advisory_lock(18471,2)');
  const running = migrate(f.catalog.pool);
  let completed;
  try {
    completed = await Promise.race([running.then(() => true), delay(3000).then(() => false)]);
  } finally {
    await held.query('SELECT pg_advisory_unlock(18471,2)');
    held.release();
    await running;
  }
  assert.equal(completed, true, 'Index migration waited for the upload reservation lock');
  await f.catalog.ready();
  assert.equal(value(await page(f)).items[0].artifactId, id);
  const before = (
    await f.catalog.pool.query("SELECT 'arkvory_asset_page_path'::regclass::oid AS id")
  ).rows[0].id;
  await f.catalog.pool.query('DELETE FROM arkvory_migrations WHERE version=11');
  await migrate(f.catalog.pool);
  await migrate(f.catalog.pool);
  assert.equal(
    (await f.catalog.pool.query("SELECT 'arkvory_asset_page_path'::regclass::oid AS id")).rows[0]
      .id,
    before,
  );
  assert.equal(
    (
      await f.catalog.pool.query(
        'SELECT count(*)::integer AS count FROM arkvory_migrations WHERE version=11',
      )
    ).rows[0].count,
    1,
  );
  // A failed concurrent build leaves an invalid index: the migration must replace it.
  await seed(f, ['existing/file'], 'other');
  await f.catalog.pool.query('DELETE FROM arkvory_migrations WHERE version=11');
  await f.catalog.pool.query('DROP INDEX arkvory_asset_page_path');
  await assert.rejects(
    f.catalog.pool.query(
      'CREATE UNIQUE INDEX CONCURRENTLY arkvory_asset_page_path ON arkvory_assets(path)',
    ),
    { code: '23505' },
  );
  assert.equal(
    (
      await f.catalog.pool.query(
        "SELECT indisvalid FROM pg_index WHERE indexrelid='arkvory_asset_page_path'::regclass",
      )
    ).rows[0].indisvalid,
    false,
  );
  await migrate(f.catalog.pool);
  assert.equal(
    (
      await f.catalog.pool.query(
        "SELECT indisvalid FROM pg_index WHERE indexrelid='arkvory_asset_page_path'::regclass",
      )
    ).rows[0].indisvalid,
    true,
  );
  await f.catalog.ready();
});
