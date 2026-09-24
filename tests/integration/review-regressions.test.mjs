import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { PostgresIdentity, migrate } from '@proanima/depot-infrastructure';
import { DepotClient } from '@proanima/depot-sdk';
import { setup } from './fixture.mjs';

test('external administrators can preflight PATCH and disable an account', async (t) => {
  const origin = 'https://ui.example.test';
  const f = await setup(t, { corsOrigins: [origin] });
  const created = await f.app.inject({
    method: 'POST',
    url: '/api/v1/users',
    headers: f.headers,
    payload: { name: 'cors-user', password: 'private-test-password' },
  });
  const url = `/api/v1/users/${created.json().id}`;
  const preflight = await f.app.inject({
    method: 'OPTIONS',
    url,
    headers: {
      origin,
      'access-control-request-method': 'PATCH',
      'access-control-request-headers': 'authorization,content-type',
    },
  });
  assert.equal(preflight.statusCode, 204, preflight.body);
  const updated = await f.app.inject({
    method: 'PATCH',
    url,
    headers: { ...f.headers, origin },
    payload: { enabled: false },
  });
  assert.equal(updated.statusCode, 200, updated.body);
  assert.equal(updated.json().enabled, false);
  assert.equal(updated.headers['access-control-allow-origin'], origin);
});

test('API readiness rejects a database without the package and identity migrations', async (t) => {
  const f = await setup(t);
  await f.catalog.pool.query('DELETE FROM depot_migrations WHERE version=8');
  await assert.rejects(f.catalog.ready(), { code: 'unavailable' });
  await f.catalog.pool.query('DELETE FROM depot_migrations WHERE version>=6');
  await assert.rejects(f.catalog.ready(), { code: 'unavailable' });
  assert.equal((await f.app.inject({ url: '/health/ready', headers: f.headers })).statusCode, 503);
});

test('online index migration does not acquire the upload reservation lock', async (t) => {
  const f = await setup(t);
  const reserved = await f.catalog.pool.connect();
  await reserved.query('SELECT pg_advisory_lock(18471,2)');
  const running = migrate(f.catalog.pool);
  let completed;
  try {
    completed = await Promise.race([running.then(() => true), delay(2000).then(() => false)]);
  } finally {
    await reserved.query('SELECT pg_advisory_unlock(18471,2)');
    reserved.release();
    await running;
  }
  assert.equal(completed, true, 'Migration waited on the live upload reservation lock');
});

test('HTTP request capacity applies before asynchronous session resolution', async (t) => {
  const f = await setup(t);
  let release;
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  let entered = 0;
  const original = PostgresIdentity.prototype.resolve;
  PostgresIdentity.prototype.resolve = async () => {
    entered++;
    await blocked;
    return null;
  };
  const headers = { authorization: `Bearer dps_${'a'.repeat(43)}` };
  const calls = Array.from({ length: 128 }, () =>
    f.app.inject({ url: '/api/v1/auth/me', headers }).then((response) => response.statusCode),
  );
  let extra, status;
  try {
    for (let attempts = 0; entered < 128 && attempts < 100; attempts++) await delay(10);
    assert.equal(entered, 128);
    extra = f.app
      .inject({ url: '/api/v1/auth/me', headers })
      .then((response) => response.statusCode);
    status = await Promise.race([extra, delay(500).then(() => null)]);
  } finally {
    release();
    await Promise.all([...calls, extra]);
    PostgresIdentity.prototype.resolve = original;
  }
  assert.equal(status, 503, 'Overflow was queued in authentication instead of being rejected');
  assert.equal(entered, 128);
});

test('administrative password work shares the bounded password gate', async (t) => {
  const f = await setup(t);
  let active = 0,
    peak = 0;
  const original = PostgresIdentity.prototype.createUser;
  PostgresIdentity.prototype.createUser = async function (...args) {
    active++;
    peak = Math.max(peak, active);
    try {
      await delay(50);
      return await original.apply(this, args);
    } finally {
      active--;
    }
  };
  try {
    const responses = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        f.app.inject({
          method: 'POST',
          url: '/api/v1/users',
          headers: f.headers,
          payload: { name: `bounded-${index}`, password: 'private-test-password' },
        }),
      ),
    );
    for (const response of responses) assert.equal(response.statusCode, 201, response.body);
  } finally {
    PostgresIdentity.prototype.createUser = original;
  }
  assert(peak <= 2, `Observed ${peak} concurrent password operations`);
});

test('concurrent account and group creation cannot overbook catalog capacity', async (t) => {
  const f = await setup(t);
  await f.catalog.pool.query(`
    INSERT INTO depot_users(id,name,password_salt,password_hash)
    SELECT gen_random_uuid(),'seed-'||i,repeat('0',32),repeat('0',128) FROM generate_series(1,999) i;
    INSERT INTO depot_access_groups(id,name)
    SELECT gen_random_uuid(),'seed-'||i FROM generate_series(1,99) i;
    CREATE FUNCTION slow_identity_insert() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN PERFORM pg_sleep(0.2); RETURN NEW; END $$;
    CREATE TRIGGER slow_user BEFORE INSERT ON depot_users FOR EACH ROW EXECUTE FUNCTION slow_identity_insert();
    CREATE TRIGGER slow_group BEFORE INSERT ON depot_access_groups FOR EACH ROW EXECUTE FUNCTION slow_identity_insert();
  `);
  const store = new PostgresIdentity(f.catalog.pool);
  for (const [create, table, limit] of [
    [(name) => store.createUser(name, 'private-test-password', false), 'depot_users', 1000],
    [(name) => store.createGroup(name), 'depot_access_groups', 100],
  ]) {
    const results = await Promise.allSettled([create('final-one'), create('final-two')]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(
      results.find((result) => result.status === 'rejected').reason.code,
      'capacity_exceeded',
    );
    assert.equal(
      (await f.catalog.pool.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count,
      limit,
    );
  }
});

test('SDK accepts a bounded page of large manifests and preserves an explicit root group', async (t) => {
  const f = await setup(t);
  await f.catalog.pool.query(`
    WITH source AS (SELECT i, gen_random_uuid() AS id FROM generate_series(1,100) i),
    uploaded AS (
      INSERT INTO depot_uploads(id,repository,owner,idempotency_key,descriptor,size,status,created_at)
      SELECT id,'releases','test','large-'||i,
        jsonb_build_object('name','large.upack','size','0','sha256',repeat('0',64),'labels','[]'::jsonb,'metadata','{}'::jsonb),
        0,'available',now() FROM source RETURNING id
    )
    INSERT INTO depot_packages(repository,package_group,name,version,artifact_id,manifest)
    SELECT 'releases',CASE WHEN i<=50 THEN '' ELSE 'Tools' END,'Example','1.0.'||i,id,
      jsonb_build_object('group',CASE WHEN i<=50 THEN '' ELSE 'Tools' END,'name','Example',
        'version','1.0.'||i,'description',repeat('x',60000))
    FROM source JOIN uploaded USING(id)
  `);
  const sdk = new DepotClient(await f.listen(), () => f.headers.authorization.slice(7));
  assert.equal((await sdk.packages('releases', { limit: 100 })).items.length, 100);
  const root = await sdk.packages('releases', { group: '', limit: 100 });
  assert.equal(root.items.length, 50);
  assert(root.items.every((item) => item.group === ''));
});

test('membership and grant budgets keep group listings usable at capacity', async (t) => {
  const f = await setup(t);
  await f.catalog.pool.query(`
    INSERT INTO depot_users(id,name,password_salt,password_hash)
    SELECT gen_random_uuid(),'seed-'||i,repeat('0',32),repeat('0',128) FROM generate_series(1,101) i;
    INSERT INTO depot_access_groups(id,name)
    SELECT gen_random_uuid(),'seed-'||i FROM generate_series(1,100) i;
    INSERT INTO depot_group_members(group_id,user_id)
    SELECT g.id,u.id FROM depot_access_groups g CROSS JOIN depot_users u WHERE u.name<>'seed-101';
    INSERT INTO depot_group_grants(group_id,repository,access)
    SELECT g.id,'repository-'||i,'read' FROM depot_access_groups g CROSS JOIN generate_series(1,100) i;
  `);
  const group = (await f.catalog.pool.query('SELECT id FROM depot_access_groups LIMIT 1')).rows[0]
    .id;
  const extra = (await f.catalog.pool.query("SELECT id FROM depot_users WHERE name='seed-101'"))
    .rows[0].id;
  const existing = (await f.catalog.pool.query("SELECT id FROM depot_users WHERE name='seed-1'"))
    .rows[0].id;
  const store = new PostgresIdentity(f.catalog.pool);
  await assert.rejects(store.membership(group, extra, true), { code: 'capacity_exceeded' });
  await assert.rejects(store.grant(group, 'repository-new', 'read'), { code: 'capacity_exceeded' });
  await store.membership(group, existing, true);
  await store.grant(group, 'repository-1', 'write');
  assert.equal((await store.groups()).length, 100);
  await store.membership(group, existing, false);
  await store.grant(group, 'repository-1', null);
  await store.membership(group, extra, true);
  await store.grant(group, 'repository-new', 'read');
  assert.equal((await store.groups()).length, 100);
});
