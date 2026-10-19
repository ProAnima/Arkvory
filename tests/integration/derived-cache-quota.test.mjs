import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { openModuleData, derivedCacheUsage } from '@proanima/arkvory-infrastructure';
import { PostgresModuleDataCoordinator } from '../../packages/infrastructure/dist/module-data-coordinator.js';
import {
  cacheFixture,
  signal,
  reservation,
  writeBuild,
  assertRead,
} from './derived-cache-fixture.mjs';

async function legacy(f) {
  const coordinator = new PostgresModuleDataCoordinator(f.catalog.pool);
  const opened = await openModuleData({
    dataDirectory: f.directory,
    moduleId: f.moduleId,
    coordinator,
    reservedUsage: () => derivedCacheUsage(f.catalog.pool, f.moduleId),
    quota: reservation,
    reserve: { bytes: 0, inodes: 0 },
    readOnly: false,
  });
  f.beforeClose.push(async () => {
    try {
      await opened.close();
    } finally {
      await coordinator.close();
    }
  });
  return opened;
}

test('derived cache: legacy ModuleFiles bytes reduce generation admission budget', async (t) => {
  const f = await cacheFixture(t);
  const old = await legacy(f);
  const sink = await old.directory.cache.create('legacy', { durable: true, exclusive: false });
  await sink.write(Buffer.alloc(4096, 41));
  await sink.close();
  const cache = f.create().cache;
  assert.equal(await cache.begin('new', reservation, signal), null);
  const parts = [];
  for await (const bytes of old.directory.cache.read('legacy')) parts.push(bytes);
  assert.deepEqual(
    Buffer.concat(parts),
    Buffer.alloc(4096, 41),
    'admission cannot evict legacy bytes',
  );
  await old.directory.cache.remove('legacy');
  const build = await cache.begin('new', reservation, signal);
  assert.ok(build);
  await writeBuild(build, { data: Buffer.from('after legacy removal') });
  await build.commit(signal);
  const reader = await cache.open('new', signal);
  try {
    await assertRead(reader, { data: Buffer.from('after legacy removal') });
  } finally {
    await reader?.release();
  }
});

test('derived cache: generation reservations reduce subsequent ModuleFiles write budget', async (t) => {
  const f = await cacheFixture(t);
  const cache = f.create().cache;
  const build = await cache.begin('reserved', reservation, signal);
  assert.ok(build);
  const old = await legacy(f);
  await assert.rejects(
    async () => {
      const sink = await old.directory.cache.create('excess', { durable: true, exclusive: false });
      try {
        await sink.write(Buffer.alloc(4096));
        await sink.close();
      } finally {
        await sink.abort();
      }
    },
    { code: 'module_quota_exceeded' },
  );
  assert.equal(await old.directory.cache.stat('excess'), null);
  await build.abort();
  await cache.reconcile();
  const sink = await old.directory.cache.create('available', { durable: true, exclusive: false });
  await sink.write(Buffer.alloc(4096, 43));
  await sink.close();
  assert.deepEqual(await old.directory.cache.stat('available'), { size: 4096 });
});

test('derived cache: mutating admitted budget cannot enlarge byte or file reservation', async (t) => {
  const f = await cacheFixture(t);
  const cache = f.create().cache;
  const requested = { bytes: 1024, files: 4 };
  const build = await cache.begin('mutable-budget', requested, signal);
  assert.ok(build);
  requested.bytes = 65536;
  requested.files = 4096;
  const result = await f.catalog.pool.query(
    'SELECT id,reserve_bytes::text,reserve_files FROM arkvory_derived_cache_generations WHERE module_id=$1 AND key=$2',
    [f.moduleId, 'mutable-budget'],
  );
  const row = result.rows[0];
  assert.equal(row.reserve_bytes, '1024');
  assert.equal(row.reserve_files, 4);
  const directory = join(f.directory, 'module-derived-cache', f.moduleId, row.id);
  const sink = await build.create('first');
  await sink.write(Buffer.from('accepted'));
  await sink.close();
  const before = await readdir(directory);
  assert.equal(before.length, 1);
  await assert.rejects(build.create('second'), { code: 'module_quota_exceeded' });
  assert.deepEqual(
    await readdir(directory),
    before,
    'file limit rejects before opening a second file',
  );
  await build.abort();

  const bytesBudget = { bytes: 1024, files: 8 };
  const byteBuild = await cache.begin('mutable-bytes', bytesBudget, signal);
  assert.ok(byteBuild);
  bytesBudget.bytes = 65536;
  const byteSink = await byteBuild.create('data');
  const generation = await f.catalog.pool.query(
    'SELECT id FROM arkvory_derived_cache_generations WHERE module_id=$1 AND key=$2',
    [f.moduleId, 'mutable-bytes'],
  );
  const byteDirectory = join(
    f.directory,
    'module-derived-cache',
    f.moduleId,
    generation.rows[0].id,
  );
  const pending = await readdir(byteDirectory);
  assert.equal(pending.length, 1);
  assert.equal((await stat(join(byteDirectory, pending[0]))).size, 0);
  await assert.rejects(byteSink.write(Buffer.alloc(2048, 7)), { code: 'module_quota_exceeded' });
  assert.equal(
    (await stat(join(byteDirectory, pending[0]))).size,
    0,
    'oversized write is refused before any extra OS bytes are written',
  );
  assert.equal(await cache.open('mutable-bytes', signal), null);
  await byteBuild.abort();
});

test('derived cache: begin snapshots budget synchronously before queued admission', async (t) => {
  const f = await cacheFixture(t);
  const cache = f.create().cache;
  const requested = { bytes: 1024, files: 4 };
  const pending = cache.begin('sync-budget', requested, signal);
  requested.bytes = 65536;
  requested.files = 4096;
  const build = await pending;
  assert.ok(build);
  const result = await f.catalog.pool.query(
    'SELECT reserve_bytes::text,reserve_files FROM arkvory_derived_cache_generations WHERE module_id=$1 AND key=$2',
    [f.moduleId, 'sync-budget'],
  );
  assert.deepEqual(result.rows, [{ reserve_bytes: '1024', reserve_files: 4 }]);
  await build.abort();
});

test('derived cache: impossible byte or file reservation preserves unpinned ready generations', async (t) => {
  const f = await cacheFixture(t);
  const cache = f.create().cache;
  const values = { data: Buffer.from('keep this cached result') };
  for (const key of ['tree-a', 'tree-b']) {
    const build = await cache.begin(key, { bytes: 4096, files: 4 }, signal);
    assert.ok(build);
    await writeBuild(build, values);
    await build.commit(signal);
  }
  const snapshot = async () =>
    (
      await f.catalog.pool.query(
        'SELECT id,key,state,manifest_hash FROM arkvory_derived_cache_generations WHERE module_id=$1 ORDER BY key',
        [f.moduleId],
      )
    ).rows;
  const before = await snapshot();
  assert.equal(before.length, 2);
  assert.ok(before.every((row) => row.state === 'ready'));
  const usage = await derivedCacheUsage(f.catalog.pool, f.moduleId);
  // No reader pins: preservation must come from admission, not eviction contention.
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const budget of [
      { bytes: reservation.bytes + 1, files: 4 },
      { bytes: 4096, files: reservation.files + 1 },
    ]) {
      assert.equal(await cache.begin('impossible', budget, signal), null);
      assert.deepEqual(await snapshot(), before);
      assert.deepEqual(await derivedCacheUsage(f.catalog.pool, f.moduleId), usage);
    }
  }
  for (const row of before) {
    const directory = join(f.directory, 'module-derived-cache', f.moduleId, row.id);
    assert.equal((await readdir(directory)).length, 2, 'payload and manifest remain on disk');
    const reader = await cache.open(row.key, signal);
    try {
      await assertRead(reader, values);
    } finally {
      await reader?.release();
    }
  }
});
