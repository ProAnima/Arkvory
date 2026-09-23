import test from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions } from '@proanima/depot-domain';
import { setup, base } from './fixture.mjs';

test('PostgreSQL SemVer order matches the domain rule and pages past 1000 versions', async (t) => {
  const f = await setup(t);
  const versions = [
    '1.9.0',
    '1.10.0',
    '1.10.0-alpha.2',
    '1.10.0-alpha.10',
    '1.10.0-alpha',
    '1.10.0+build.2',
    '1.10.0+build.1',
    '2.0.0',
    '999999999999999999999999.0.0',
  ];
  const ordered = await f.catalog.pool.query(
    'SELECT value FROM unnest($1::text[]) AS value ORDER BY depot_semver_key(value) COLLATE "C", value COLLATE "C"',
    [versions],
  );
  assert.deepEqual(
    ordered.rows.map((row) => row.value),
    [...versions].sort((a, b) => compareVersions(a, b) || (a < b ? -1 : a > b ? 1 : 0)),
  );

  await f.catalog.pool.query(
    `WITH source AS (SELECT i,gen_random_uuid() AS id FROM generate_series(0,1004) AS i),
     inserted AS (
       INSERT INTO depot_uploads(id,repository,owner,idempotency_key,descriptor,size,status,created_at)
       SELECT id,'releases','pagination-test','seed-'||i,
              jsonb_build_object('name','seed-'||i||'.upack','size','0','sha256',$1::text,
                                 'labels',jsonb_build_array(),'metadata',jsonb_build_object()),
              0,'available',now() FROM source RETURNING id,idempotency_key
     )
     INSERT INTO depot_packages(repository,package_group,name,version,artifact_id,manifest)
     SELECT 'releases','Tools','Example','1.0.'||split_part(idempotency_key,'-',2),id,
            jsonb_build_object('group','Tools','name','Example',
                               'version','1.0.'||split_part(idempotency_key,'-',2))
     FROM inserted`,
    ['0'.repeat(64)],
  );
  const seen = [];
  let after;
  do {
    const params = new URLSearchParams({ sort: 'version', direction: 'desc', limit: '73' });
    if (after) params.set('after', after);
    const response = await f.app.inject({ url: `${base}/packages?${params}`, headers: f.headers });
    assert.equal(response.statusCode, 200, response.body);
    const page = response.json();
    assert.ok(page.items.length > 0 && page.items.length <= 73);
    seen.push(...page.items.map((item) => item.version));
    after = page.next;
  } while (after);
  assert.equal(seen.length, 1005);
  assert.equal(new Set(seen).size, 1005);
  assert.deepEqual(
    seen,
    Array.from({ length: 1005 }, (_, index) => `1.0.${1004 - index}`),
  );
  const first = await f.app.inject({
    url: `${base}/packages?sort=version&direction=asc&limit=1`,
    headers: f.headers,
  });
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(first.json().items[0].version, '1.0.0');
  const invalidCursor = await f.app.inject({
    url: `${base}/packages?after=not-a-cursor`,
    headers: f.headers,
  });
  assert.equal(invalidCursor.statusCode, 400, invalidCursor.body);
  assert.equal(
    (
      await f.app.inject({
        url: `${base}/packages?sort=version&direction=desc&limit=1&after=${first.json().next}`,
        headers: f.headers,
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await f.app.inject({
        url: `${base}/packages?sort=version&direction=asc&group=Tools&after=${first.json().next}`,
        headers: f.headers,
      })
    ).statusCode,
    400,
  );
  await f.catalog.pool.query(
    `WITH source AS (
       SELECT package_group,name,version,gen_random_uuid() AS id
       FROM (VALUES ('Alpha','A','1.0.0'),('Zeta','Z','2.0.0')) AS entry(package_group,name,version)
     ), inserted AS (
       INSERT INTO depot_uploads(id,repository,owner,idempotency_key,descriptor,size,status,created_at)
       SELECT id,'releases','pagination-test','extra-'||package_group,
              jsonb_build_object('name',name||'.upack','size','0','sha256',$1::text,
                                 'labels',jsonb_build_array(),'metadata',jsonb_build_object()),
              0,'available',now() FROM source RETURNING id,idempotency_key
     )
     INSERT INTO depot_packages(repository,package_group,name,version,artifact_id,manifest)
     SELECT 'releases',source.package_group,source.name,source.version,source.id,
            jsonb_build_object('group',source.package_group,'name',source.name,'version',source.version)
     FROM source JOIN inserted USING (id)`,
    ['0'.repeat(64)],
  );
  const page = async (sort, direction, after) => {
    const params = new URLSearchParams({ sort, direction, groupBy: 'group', limit: '1' });
    if (after) params.set('after', after);
    const response = await f.app.inject({ url: `${base}/packages?${params}`, headers: f.headers });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json().groups[0].artifactIds, [response.json().items[0].artifactId]);
    return response.json();
  };
  for (const [sort, direction, firstGroup] of [
    ['group', 'asc', 'Alpha'],
    ['group', 'desc', 'Zeta'],
    ['name', 'asc', 'Alpha'],
    ['name', 'desc', 'Zeta'],
    ['version', 'asc', 'Alpha'],
    ['version', 'desc', 'Zeta'],
  ]) {
    const start = await page(sort, direction);
    assert.equal(start.items[0].group, firstGroup);
    const following = await page(sort, direction, start.next);
    assert.equal(following.items[0].group, 'Tools');
  }
  const filtered = await f.app.inject({
    url: `${base}/packages?group=Alpha&limit=1`,
    headers: f.headers,
  });
  assert.equal(filtered.statusCode, 200, filtered.body);
  assert.equal(filtered.json().next, null);
  assert.equal(filtered.json().items[0].name, 'A');
});
