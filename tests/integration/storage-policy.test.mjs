import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ArkvoryClient } from '@proanima/arkvory-sdk';
import { defaultStoragePolicy, serviceActions } from '@proanima/arkvory-domain';
import { PostgresStoragePolicy, PostgresServices } from '@proanima/arkvory-infrastructure';
import { maintainStorage } from '../../apps/api/dist/storage-maintenance.js';
import { setup, create, base } from './fixture.mjs';
import { validateResponse } from '../api-schema.mjs';

test('bounded cleanup skips pinned rows without starving old builds and diagnostics prune independently of audit', async (t) => {
  const f = await setup(t),
    a = await access(f),
    store = new PostgresStoragePolicy(f.catalog.pool);
  await f.catalog.pool
    .query(`INSERT INTO arkvory_uploads(id,repository,owner,idempotency_key,descriptor,size,status,created_at,published_at)
    SELECT gen_random_uuid(),'releases','seed',i::text,
      jsonb_build_object('name','seed.upack','size','0','sha256',repeat('0',64),'labels','[]'::jsonb,'metadata','{}'::jsonb),
      0,'available',now()-interval '3 days',now()-(i*interval '1 hour') FROM generate_series(1,226) i`);
  await f.catalog.pool
    .query(`INSERT INTO arkvory_packages(repository,package_group,name,version,artifact_id,manifest)
    SELECT repository,'','seed','1.0.'||idempotency_key,id,'{"name":"seed","version":"1.0.0"}'::jsonb FROM arkvory_uploads`);
  await f.catalog.pool.query(`INSERT INTO arkvory_references(repository,artifact_id,owner,reference)
    SELECT repository,id,'external','pinned' FROM arkvory_uploads WHERE idempotency_key::integer>106`);
  await a.client.setStoragePolicy('releases', 0, policy({ grouping: 'repository' }));
  const preview = await a.client.previewStoragePolicy('releases');
  assert.equal(preview.items.length, 100);
  assert.equal(preview.hasMore, true);
  const run = await a.client.runStoragePolicy('releases', 1);
  assert.equal(run.items.length, 100);
  assert.equal((await a.client.runStoragePolicy('releases', 1)).items.length, 5);
  assert.equal((await a.client.runStoragePolicy('releases', 1)).items.length, 0);
  await f.catalog.pool.query(
    `INSERT INTO arkvory_storage_events(repository,level,code,details) SELECT 'releases','warning','test.bounded','{}'::jsonb FROM generate_series(1,1100)`,
  );
  await store.recordEvent('releases', 'info', 'test.latest', {});
  assert.equal(
    (await f.catalog.pool.query('SELECT count(*) FROM arkvory_storage_events')).rows[0].count,
    '1000',
  );
  assert.equal(
    (
      await f.catalog.pool.query(
        "SELECT count(*) FROM arkvory_audit WHERE action='artifact.delete'",
      )
    ).rows[0].count,
    '105',
  );
  const first = await a.client.storageEvents('releases', { level: 'warning' });
  assert.equal(first.items.length, 100);
  assert.ok(first.next);
  const second = await a.client.storageEvents('releases', { after: first.next, level: 'warning' });
  assert.ok(BigInt(second.items[0].sequence) > BigInt(first.next));
});

async function access(f, actions = serviceActions) {
  f.config.keys[0].principal.serviceAdministrator = true;
  const url = await f.listen(),
    root = new ArkvoryClient(url, () => f.headers.authorization.slice(7));
  const bindings = [{ resource: { kind: 'repository', id: 'releases' }, actions }];
  const account = await root.createServiceAccount('storage-manager', bindings);
  const key = await root.issueServiceKey(account.id, randomUUID(), {
    name: 'storage-policy',
    bindings,
  });
  const client = new ArkvoryClient(url, () => key.secret);
  await client.activateServiceKey();
  return { root, client, key, headers: { authorization: 'Bearer ' + key.secret } };
}
async function build(f, name, age, labels = ['test']) {
  const bytes = Buffer.from(randomUUID()),
    created = await create(f, bytes),
    id = created.json().id;
  assert.equal(created.statusCode, 201, created.body);
  const done = await f.app.inject({
    method: 'PUT',
    url: base + '/uploads/' + id + '/content',
    headers: { ...f.headers, 'content-type': 'application/octet-stream' },
    payload: bytes,
  });
  assert.equal(done.statusCode, 200, done.body);
  await f.catalog.pool.query(
    "UPDATE arkvory_uploads SET published_at=now()-($2::integer * interval '1 hour'),descriptor=jsonb_set(descriptor,'{labels}',$3::jsonb) WHERE id=$1",
    [id, age, JSON.stringify(labels)],
  );
  if (name)
    await f.catalog.pool.query(
      'INSERT INTO arkvory_packages(repository,package_group,name,version,artifact_id,manifest) VALUES($1,$2,$3,$4,$5,$6)',
      [
        'releases',
        'team',
        name,
        `1.0.${age}`,
        id,
        JSON.stringify({ name, version: `1.0.${age}`, _build: { ci: 123 } }),
      ],
    );
  return id;
}
const policy = (overrides = {}) => ({
  ...defaultStoragePolicy(),
  enabled: true,
  keepLast: 1,
  minAgeHours: 0,
  channels: [
    { label: 'test', keepLast: 1 },
    { label: 'staging', keepLast: 1 },
  ],
  ...overrides,
});

test('last N per package/channel preserves multi-channel, protected, pinned and ordinary files; global mode is explicit', async (t) => {
  const f = await setup(t),
    a = await access(f),
    store = new PostgresStoragePolicy(f.catalog.pool);
  const old = await build(f, 'one', 20),
    mixed = await build(f, 'one', 15, ['test', 'staging']),
    newest = await build(f, 'one', 5),
    other = await build(f, 'two', 8);
  const protectedId = await build(f, 'one', 30, ['bse']),
    pinned = await build(f, 'one', 25),
    raw = await build(f, null, 40);
  await f.catalog.pool.query(
    'INSERT INTO arkvory_references(repository,artifact_id,owner,reference) VALUES($1,$2,$3,$4)',
    ['releases', pinned, 'external', 'production'],
  );
  assert.equal((await a.client.storagePolicy('releases')).policy.enabled, false);
  await a.client.setStoragePolicy('releases', 0, policy());
  const preview = await a.client.previewStoragePolicy('releases');
  assert.deepEqual(
    preview.items.map((i) => i.id),
    [old],
  );
  await assert.rejects(a.client.setStoragePolicy('releases', 0, policy()), { status: 409 });
  const run = await a.client.runStoragePolicy('releases', 1);
  assert.deepEqual(
    run.items.map((i) => [i.id, i.outcome]),
    [[old, 'deleted']],
  );
  assert.equal((await a.client.storageUsage('releases')).retiredBytes, '36');
  for (const id of [mixed, newest, other, protectedId, pinned, raw])
    assert.equal((await f.catalog.get('releases', id)).status, 'available');
  await a.client.setStoragePolicy('releases', 1, policy({ grouping: 'repository' }));
  assert.deepEqual(
    new Set((await a.client.previewStoragePolicy('releases')).items.map((i) => i.id)),
    new Set([mixed, other]),
  );
  await a.client.setStoragePolicy('releases', 2, policy({ grouping: 'package' }));
  assert.deepEqual(
    (await a.client.previewStoragePolicy('releases')).items.map((i) => i.id),
    [mixed],
  );
  await a.client.setStoragePolicy(
    'releases',
    3,
    policy({ grouping: 'repository', minAgeHours: 20 }),
  );
  assert.equal((await a.client.previewStoragePolicy('releases')).items.length, 0);
  const events = await store.events('releases', '0');
  assert.ok(events.items.some((e) => e.code === 'retention.completed'));
  assert.equal(
    (
      await f.catalog.pool.query(
        "SELECT count(*) FROM arkvory_audit WHERE action='artifact.delete'",
      )
    ).rows[0].count,
    '1',
  );
});

test('quota reserves concurrently, replays existing upload and retains cancelled bytes until GC', async (t) => {
  const f = await setup(t),
    a = await access(f);
  await a.client.setStoragePolicy(
    'releases',
    0,
    policy({ enabled: false, quotaBytes: '60', warningPercent: 50, criticalPercent: 90 }),
  );
  const key = randomUUID(),
    bytes = Buffer.alloc(36);
  const responses = await Promise.all([create(f, bytes, key), create(f, bytes)]);
  assert.deepEqual(responses.map((r) => r.statusCode).sort(), [201, 507]);
  const successful = responses.find((r) => r.statusCode === 201).json();
  if (responses[0].statusCode === 201)
    assert.equal((await create(f, bytes, key)).json().id, successful.id);
  let usage = await a.client.storageUsage('releases');
  assert.equal(usage.reservedBytes, '36');
  assert.equal(usage.state, 'warning');
  await a.client.setStoragePolicy('releases', 1, policy({ enabled: false, quotaBytes: '30' }));
  assert.equal(
    (
      await f.app.inject({
        method: 'DELETE',
        url: base + '/uploads/' + successful.id,
        headers: f.headers,
      })
    ).statusCode,
    200,
  );
  usage = await a.client.storageUsage('releases');
  assert.equal(usage.retiredBytes, '36');
  assert.equal(usage.state, 'exceeded');
  assert.equal((await create(f, Buffer.alloc(1))).statusCode, 507);
  const store = new PostgresStoragePolicy(f.catalog.pool);
  await store.monitorCapacities(() => true);
  const events = await a.client.storageEvents('releases', { level: 'error' });
  assert.ok(events.items.some((e) => e.code === 'capacity.exceeded'));
  await store.monitorCapacities(() => true);
  assert.equal(
    (await a.client.storageEvents('releases', { level: 'error' })).items.length,
    events.items.length,
  );
});

test('automatic runs survive restart, reauthorize keys, respect due time and never run disabled policies', async (t) => {
  const f = await setup(t),
    a = await access(f),
    old = await build(f, 'a', 20);
  await build(f, 'a', 10);
  await a.client.setStoragePolicy('releases', 0, policy());
  await f.restart();
  const store = new PostgresStoragePolicy(f.catalog.pool),
    services = new PostgresServices(f.catalog.pool);
  await maintainStorage(store, services, () => true);
  assert.equal((await f.catalog.get('releases', old)).status, 'cancelled');
  const snapshot = await store.get('releases');
  assert.equal(snapshot.lastDeleted, 1);
  const later = await build(f, 'a', 30);
  await maintainStorage(store, services, () => true);
  assert.equal((await f.catalog.get('releases', later)).status, 'available');
  // Revoke through the public administrative API after restarting its URL.
  const url = await f.listen(),
    root = new ArkvoryClient(url, () => f.headers.authorization.slice(7));
  await root.revokeServiceKey(a.key.key.id);
  await f.catalog.pool.query(
    "UPDATE arkvory_storage_policies SET next_run_at=now()-interval '1 minute'",
  );
  await maintainStorage(store, services, () => true);
  assert.equal((await f.catalog.get('releases', later)).status, 'available');
  assert.equal((await store.get('releases')).lastError, 'forbidden');
  assert.ok((await store.events('releases', '0')).items.some((e) => e.code === 'retention.failed'));
});

test('storage operations enforce scoped managed permissions, validate contracts and reject unsafe input', async (t) => {
  const f = await setup(t),
    a = await access(f, ['storage.read', 'storage.manage', 'diagnostics.read']);
  await a.client.setStoragePolicy('releases', 0, policy({ enabled: false }));
  await assert.rejects(a.client.setStoragePolicy('releases', 1, policy()), { status: 403 });
  await assert.rejects(a.client.storageUsage('hidden'), { status: 403 });
  await assert.rejects(a.client.previewStoragePolicy('releases'), { status: 403 });
  for (const suffix of ['policy', 'usage', 'events']) {
    const r = await f.app.inject({ url: base + '/storage/' + suffix, headers: a.headers });
    assert.equal(r.statusCode, 200, r.body);
    validateResponse('/api/v1/repositories/{repository}/storage/' + suffix, 'get', r);
    assert.equal(
      (await f.app.inject({ url: base + '/storage/' + suffix, headers: f.headers })).statusCode,
      403,
    );
  }
  for (const change of [
    { keepLast: 0 },
    { grouping: 'all' },
    { quotaBytes: '9007199254740992' },
    { warningPercent: 95, criticalPercent: 90 },
    {
      channels: [
        { label: 'test', keepLast: 1 },
        { label: 'test', keepLast: 3 },
      ],
    },
  ]) {
    await assert.rejects(
      a.client.setStoragePolicy('releases', 1, policy({ enabled: false, ...change })),
      { status: 400 },
    );
  }
  assert.equal(
    (
      await f.app.inject({
        url: base + '/storage/events?after=9223372036854775808',
        headers: a.headers,
      })
    ).statusCode,
    400,
  );
});

test('preview cannot delete a build newly pinned or promoted before execution', async (t) => {
  const f = await setup(t),
    a = await access(f),
    old = await build(f, 'a', 20);
  await build(f, 'a', 10);
  await a.client.setStoragePolicy('releases', 0, policy());
  assert.equal((await a.client.previewStoragePolicy('releases')).items.length, 1);
  await a.client.annotate('releases', old, 0, {
    labels: ['release'],
    metadata: {},
    collections: [],
  });
  assert.equal((await a.client.runStoragePolicy('releases', 1)).items.length, 0);
  assert.equal((await f.catalog.get('releases', old)).status, 'available');
});

test('disabled policies do not schedule deletion and persisted HTTP diagnostics exclude secrets and query data', async (t) => {
  const f = await setup(t),
    a = await access(f),
    store = new PostgresStoragePolicy(f.catalog.pool);
  const old = await build(f, 'disabled', 20);
  await build(f, 'disabled', 10);
  const saved = await a.client.setStoragePolicy('releases', 0, policy({ enabled: false }));
  assert.equal(saved.nextRunAt, null);
  await maintainStorage(store, new PostgresServices(f.catalog.pool), () => true);
  assert.equal((await f.catalog.get('releases', old)).status, 'available');
  const canary = 'secret-canary-' + randomUUID();
  const rejected = await f.app.inject({
    url: base + '/storage/policy?unsafe=' + canary,
    headers: { ...a.headers, 'x-private': canary },
  });
  assert.equal(rejected.statusCode, 400);
  await f.app.close();
  const events = await store.events('releases', '0');
  const entry = events.items.find((e) => e.code === 'invalid_input');
  assert.ok(entry);
  assert.equal(entry.details.route, '/api/v1/repositories/:repository/storage/policy');
  assert.equal(entry.details.requestId, rejected.json().requestId);
  assert.equal(JSON.stringify(events).includes(canary), false);
  assert.equal(JSON.stringify(events).includes(a.key.secret), false);
});
