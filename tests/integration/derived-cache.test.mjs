import { Pool } from 'pg';
import { ModuleDerivedCache } from '@proanima/arkvory-infrastructure';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cacheFixture,
  signal,
  reservation,
  writeBuild,
  assertRead,
} from './derived-cache-fixture.mjs';

const payload = (tag) => ({
  marker: Buffer.from(tag),
  'pages/data': Buffer.alloc(48 * 1024, tag.charCodeAt(0)),
});

test('derived cache: concurrent same-key builders have one winner and publish one complete group', async (t) => {
  const f = await cacheFixture(t, { bytes: reservation.bytes * 2, files: 16 });
  const a = f.create().cache;
  const b = f.create().cache;
  const builds = await Promise.all([
    a.begin('same', reservation, signal),
    b.begin('same', reservation, signal),
  ]);
  assert.equal(
    builds.filter(Boolean).length,
    1,
    'one admission, not two independently successful writes',
  );
  const winner = builds.find(Boolean);
  assert.equal(await a.open('same', signal), null, 'building bytes must remain invisible');
  const expected = payload('A');
  await writeBuild(winner, expected);
  assert.equal(await b.open('same', signal), null, 'closed files alone do not publish the group');
  await winner.commit(signal);
  await winner.commit(signal);
  await winner.abort();
  const reader = await b.open('same', signal);
  try {
    await assertRead(reader, expected);
  } finally {
    await reader?.release();
  }
});

test('derived cache: a reader pin prevents pressure eviction until release', async (t) => {
  const f = await cacheFixture(t);
  const a = f.create().cache;
  const b = f.create().cache;
  const expected = payload('P');
  const build = await a.begin('pinned', reservation, signal);
  assert.ok(build);
  await writeBuild(build, expected);
  await build.commit(signal);
  const reader = await b.open('pinned', signal);
  assert.ok(reader);
  try {
    assert.equal(await a.begin('pressure', reservation, signal), null);
    await a.reconcile();
    await assertRead(reader, expected);
  } finally {
    await reader.release();
  }
  await reader.release();
  await assert.rejects(reader.stat('marker'));
  const admitted = await a.begin('pressure', reservation, signal);
  assert.ok(admitted, 'released ready generation must be evictable under pressure');
  await writeBuild(admitted, payload('Q'));
  await admitted.commit(signal);
  assert.equal(
    await b.open('pinned', signal),
    null,
    'pressure actually evicted the old generation',
  );
  const next = await b.open('pressure', signal);
  try {
    await assertRead(next, payload('Q'));
  } finally {
    await next?.release();
  }
});

test('derived cache: a new adapter preserves ready bytes and honors the shared reservation', async (t) => {
  const f = await cacheFixture(t);
  const first = f.create().cache;
  const build = await first.begin('restart', reservation, signal);
  assert.ok(build);
  await writeBuild(build, payload('R'));
  await build.commit(signal);
  await first.close();
  const restarted = f.create().cache;
  await restarted.reconcile();
  const reader = await restarted.open('restart', signal);
  try {
    await assertRead(reader, payload('R'));
    const other = f.create().cache;
    assert.equal(
      await other.begin('over-quota', reservation, signal),
      null,
      'fresh process cannot reset the accounting of pinned disk bytes',
    );
  } finally {
    await reader?.release();
  }
});

test('derived cache: graceful shutdown cleans incomplete builds and returns their reservation', async (t) => {
  const f = await cacheFixture(t);
  const a = f.create().cache;
  const b = f.create().cache;
  const build = await a.begin('incomplete', reservation, signal);
  assert.ok(build);
  const sink = await build.create('unfinished');
  await sink.write(Buffer.alloc(4096, 9));
  assert.equal(await b.begin('blocked', reservation, signal), null);
  await a.close();
  await a.close();
  await assert.rejects(build.commit(signal));
  await b.reconcile();
  assert.equal(await b.open('incomplete', signal), null);
  const next = await b.begin('replacement', reservation, signal);
  assert.ok(
    next,
    'normal close proves local I/O quiescence and releases the abandoned reservation',
  );
  await writeBuild(next, payload('S'));
  await next.commit(signal);
  const reader = await b.open('replacement', signal);
  try {
    await assertRead(reader, payload('S'));
  } finally {
    await reader?.release();
  }
});

test('derived cache: PG session loss fences commit and does not prove owner quiescence', async (t) => {
  const f = await cacheFixture(t);
  const owner = f.create();
  const survivor = f.create().cache;
  const build = await owner.cache.begin('lost', reservation, signal);
  assert.ok(build);
  await writeBuild(build, payload('L'));
  await f.terminate(owner);
  await assert.rejects(build.commit(signal));
  assert.equal(await survivor.open('lost', signal), null);
  for (let sweep = 0; sweep < 3; sweep++) {
    await survivor.reconcile();
    assert.equal(
      await survivor.begin('new-owner', reservation, signal),
      null,
      'session loss and repeated sweeps must not release a possibly active old owner reservation',
    );
  }
  await assert.rejects(build.create('late'));
});

test('derived cache: read-only adapter reads complete groups but cannot build or reclaim pins', async (t) => {
  const f = await cacheFixture(t);
  const writer = f.create().cache;
  const readonly = f.create(true).cache;
  const build = await writer.begin('readonly', reservation, signal);
  assert.ok(build);
  const expected = payload('V');
  await writeBuild(build, expected);
  await build.commit(signal);
  await assert.rejects(readonly.begin('forbidden', reservation, signal), { code: 'read_only' });
  const reader = await readonly.open('readonly', signal);
  try {
    await assertRead(reader, expected);
  } finally {
    await reader?.release();
  }
});

test('derived cache: unfinished sink blocks commit and aborted names never become visible', async (t) => {
  const f = await cacheFixture(t);
  const cache = f.create().cache;
  const build = await cache.begin('partial', reservation, signal);
  assert.ok(build);
  const sink = await build.create('partial');
  await sink.write(Buffer.from('prefix'));
  await assert.rejects(build.commit(signal), { code: 'conflict' });
  assert.equal(await cache.open('partial', signal), null);
  await sink.abort();
  await build.abort();
  await build.abort();
  await cache.reconcile();
  const fresh = await cache.begin('partial', reservation, signal);
  assert.ok(fresh);
  const expected = { complete: Buffer.from('entirely new generation') };
  await writeBuild(fresh, expected);
  await fresh.commit(signal);
  const reader = await cache.open('partial', signal);
  try {
    await assertRead(reader, expected);
  } finally {
    await reader?.release();
  }
});

test('derived cache: close drains a build with both pool slots held by owner and coordinator', async (t) => {
  const f = await cacheFixture(t);
  const pool = new Pool({
    connectionString: f.config.databaseUrl,
    max: 2,
    connectionTimeoutMillis: 1000,
    statement_timeout: 5000,
  });
  const poolErrors = [];
  pool.on('error', (error) => poolErrors.push(error));
  const cache = new ModuleDerivedCache({
    pool,
    dataDirectory: f.directory,
    moduleId: f.moduleId,
    quota: reservation,
    reserve: { bytes: 0, inodes: 0 },
    readOnly: false,
  });
  f.instances.push({ cache, pool, poolErrors });
  const build = await cache.begin('close-full-pool', reservation, signal);
  assert.ok(build);
  const sink = await build.create('pending');
  await sink.write(Buffer.from('must drain before quiescence'));
  assert.equal(pool.totalCount, 2);
  assert.equal(pool.idleCount, 0);
  await cache.close();
  assert.equal(pool.totalCount, 0);
  assert.deepEqual(poolErrors, []);
  const owner = await f.catalog.pool.query(
    'SELECT quiescent FROM arkvory_derived_cache_owners WHERE id=$1',
    [cache.ownerId],
  );
  assert.deepEqual(owner.rows, [{ quiescent: true }]);
  await assert.rejects(sink.write(Buffer.from('late')));
  const next = f.create().cache;
  await next.reconcile();
  assert.equal(
    (
      await f.catalog.pool.query(
        'SELECT count(*)::int AS n FROM arkvory_derived_cache_generations WHERE module_id=$1',
        [f.moduleId],
      )
    ).rows[0].n,
    0,
  );
});
