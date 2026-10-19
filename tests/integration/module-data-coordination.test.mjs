import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { openModuleData, ModuleHostServices } from '@proanima/arkvory-infrastructure';
import { PostgresModuleDataCoordinator } from '../../packages/infrastructure/dist/module-data-coordinator.js';
import { removeTestDirectory } from '../helpers.mjs';
import { setup } from './fixture.mjs';

const options = { durable: false, exclusive: false };
async function fixture(t, quota = { bytes: 10, files: 3 }) {
  if (!process.env.ARKVORY_TEST_DATABASE_URL) throw new Error('ARKVORY_TEST_DATABASE_URL required');
  const pool = new Pool({
    connectionString: process.env.ARKVORY_TEST_DATABASE_URL,
    max: 3,
    connectionTimeoutMillis: 2000,
  });
  const root = await mkdtemp(join(tmpdir(), 'arkvory-coordinated-data-'));
  const moduleId = 'test-' + randomUUID().replaceAll('-', '').slice(0, 20);
  const coordinators = [
    new PostgresModuleDataCoordinator(pool),
    new PostgresModuleDataCoordinator(pool),
  ];
  const handles = [];
  t.after(async () => {
    try {
      await Promise.allSettled(handles.map((handle) => handle.close()));
    } finally {
      await Promise.all(coordinators.map((coordinator) => coordinator.close()));
      await pool.end();
      await removeTestDirectory(root);
    }
  });
  for (const coordinator of coordinators)
    handles.push(
      await openModuleData({
        dataDirectory: root,
        moduleId,
        coordinator,
        quota,
        reserve: { bytes: 0, inodes: 0 },
        readOnly: false,
      }),
    );
  return {
    pool,
    root,
    moduleId,
    coordinators,
    handles,
    first: handles[0].directory.data,
    second: handles[1].directory.data,
  };
}

test('independent hosts charge live temporary bytes before each write and reserve file slots', async (t) => {
  const f = await fixture(t);
  const a = await f.first.create('a', options);
  const b = await f.second.create('b', options);
  await a.write(Buffer.alloc(6));
  await assert.rejects(b.write(Buffer.alloc(5)), { code: 'module_quota_exceeded' });
  const c = await f.second.create('c', options);
  await c.write(Buffer.alloc(4));
  await a.close();
  await c.close();
  assert.equal(f.first.usage().bytes, 6);
  await f.handles[0].reconcile();
  assert.equal(f.first.usage().bytes, 10);
  const d = await f.first.create('d', options);
  await assert.rejects(f.second.create('e', options), { code: 'module_quota_exceeded' });
  await d.abort();
  assert.equal(f.pool.totalCount, 2, 'one dedicated session per host, not per sink');
});

test('module admission is nonblocking and excludes another coordinator', async (t) => {
  const f = await fixture(t);
  let release;
  let entered;
  const ready = new Promise((resolve) => {
    entered = resolve;
  });
  const hold = new Promise((resolve) => {
    release = resolve;
  });
  const running = f.coordinators[0].run(f.moduleId, async () => {
    entered();
    await hold;
  });
  await ready;
  try {
    await assert.rejects(f.second.create('blocked', options), { code: 'busy' });
  } finally {
    release();
    await running;
  }
  const sink = await f.second.create('admitted', options);
  await sink.abort();
});

test('session loss fences old sinks and permits restart cleanup; live and legacy tmp survive', async (t) => {
  const f = await fixture(t, { bytes: 10, files: 5 });
  const stale = await f.first.create('stale', options);
  await stale.write(Buffer.alloc(7));
  const live = await f.second.create('live', options);
  await live.write(Buffer.alloc(2));
  const base = join(f.root, 'module-data', f.moduleId, 'tmp');
  const owner = join(base, 'coordinated-v1', f.coordinators[0].owner);
  const liveOwner = join(base, 'coordinated-v1', f.coordinators[1].owner);
  await f.handles[1].reconcile();
  assert.equal((await readdir(owner)).length, 1, 'live session is never reclaimed');
  const key = createHash('sha256')
    .update(`module-data:owner:${f.coordinators[0].owner}`)
    .digest()
    .readBigInt64BE()
    .toString();
  const killed = await f.pool.query(
    `SELECT pg_terminate_backend(pid) AS killed FROM pg_locks
    WHERE locktype='advisory' AND objsubid=1 AND granted
    AND ((classid::bigint << 32) | objid::bigint)=$1::bigint
    AND database=(SELECT oid FROM pg_database WHERE datname=current_database())`,
    [key],
  );
  assert.equal(killed.rows[0]?.killed, true);
  await assert.rejects(stale.close());
  // Release the OS handle as process death would. Ownership loss forbids unlink on this host.
  await stale.abort().catch(() => undefined);
  assert.equal(await f.first.stat('stale'), null);
  assert.equal((await readdir(owner)).length, 1);
  await f.handles[1].reconcile();
  await assert.rejects(readdir(owner), { code: 'ENOENT' });
  assert.equal((await readdir(liveOwner)).length, 1);
  await mkdir(join(base, 'legacy'));
  await writeFile(join(base, 'legacy', 'unknown-owner'), Buffer.alloc(7));
  await f.handles[1].reconcile();
  await assert.rejects(live.write(Buffer.alloc(2)), { code: 'module_quota_exceeded' });
  assert.equal((await readdir(join(base, 'legacy'))).length, 1);
  await assert.rejects(f.first.create('old-host', options));
});

test('directory close drains sinks before coordinator release and shutdown is idempotent', async (t) => {
  const f = await fixture(t);
  const sink = await f.first.create('pending', options);
  await sink.write(Buffer.alloc(5));
  await f.handles[0].close();
  await f.handles[0].close();
  await f.coordinators[0].close();
  await assert.rejects(sink.close());
  await f.handles[1].reconcile();
  const next = await f.second.create('next', options);
  await next.write(Buffer.alloc(10));
  await next.close();
});

test('two runtime hosts receive mandatory coordinators and drain before pool close', async (t) => {
  const f = await fixture(t);
  // Runtime hosts account reservations in migration 49; bare coordinator tests above
  // deliberately need no catalog schema, but this host fixture must use a migrated DB.
  const runtime = await setup(t);
  const pool = runtime.catalog.sessions;
  await Promise.all(f.handles.map((handle) => handle.close()));
  await Promise.all(f.coordinators.map((coordinator) => coordinator.close()));
  const sources = {
    dataDirectory: f.root,
    dataPool: pool,
    reserve: { bytes: 0, inodes: 0 },
    readOnly: false,
    catalog: () => ({}),
  };
  const hosts = [new ModuleHostServices(sources), new ModuleHostServices(sources)];
  const planned = {
    manifest: { id: f.moduleId, uses: ['data-directory'], roles: ['api'] },
    source: 'operator',
    enabled: true,
  };
  try {
    const areas = [];
    for (const host of hosts) {
      const area = host.for(planned, { dataMiB: 1, dataFiles: 1 })['data-directory'].data;
      await area.stat('not-yet-created');
      areas.push(area);
    }
    const sink = await areas[0].create('first', options);
    await sink.write(Buffer.alloc(8));
    await assert.rejects(areas[1].create('second', options), { code: 'module_quota_exceeded' });
    await hosts[0].close();
    const next = await areas[1].create('second', options);
    await next.close();
    assert.equal(areas[1].usage().files, 1);
  } finally {
    await Promise.all(hosts.map((host) => host.close()));
  }
  assert.equal(pool.waitingCount, 0);
  assert.equal(pool.totalCount, pool.idleCount, 'no checked-out owner sessions survive shutdown');
});
