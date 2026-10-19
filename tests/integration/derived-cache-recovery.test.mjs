import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { Pool } from 'pg';
import {
  migrate,
  ModuleDerivedCache,
  openModuleData,
  derivedCacheUsage,
} from '@proanima/arkvory-infrastructure';
import { PostgresModuleDataCoordinator } from '../../packages/infrastructure/dist/module-data-coordinator.js';
import { removeTestDirectory } from '../helpers.mjs';
import { cacheFixture, signal, reservation } from './derived-cache-fixture.mjs';

async function generation(f, key) {
  const result = await f.catalog.pool.query(
    'SELECT id,state FROM arkvory_derived_cache_generations WHERE module_id=$1 AND key=$2',
    [f.moduleId, key],
  );
  assert.equal(result.rowCount, 1);
  return {
    ...result.rows[0],
    path: join(f.directory, 'module-derived-cache', f.moduleId, result.rows[0].id),
  };
}

// Registered node-test file is process-isolated; patches affect only this file's serial tests.
function patchFs(name, wrapper) {
  const original = fs.promises[name];
  fs.promises[name] = wrapper(original);
  syncBuiltinESMExports();
  return () => {
    fs.promises[name] = original;
    syncBuiltinESMExports();
  };
}

test('derived recovery: unlink failure retains physical namespace and charge until successful removal', async (t) => {
  const f = await cacheFixture(t);
  const writer = f.create().cache;
  const build = await writer.begin('orphan', reservation, signal);
  assert.ok(build);
  const sink = await build.create('payload');
  await sink.write(Buffer.from('durable orphan'));
  await sink.close();
  const g = await generation(f, 'orphan');
  await writer.close();
  const collector = f.create().cache;
  const failure = Object.assign(new Error('injected unlink denial'), { code: 'EACCES' });
  let failures = 0;
  const restoreUnlink = patchFs('unlink', (original) => async (path, ...args) => {
    if (dirname(String(path)) === g.path) {
      failures++;
      throw failure;
    }
    return original(path, ...args);
  });
  try {
    await assert.rejects(collector.reconcile(), (error) => error === failure);
    assert.equal(failures, 1);
    assert.equal((await fs.promises.readdir(g.path)).length, 1);
    assert.equal((await generation(f, 'orphan')).state, 'deleting');
    assert.deepEqual(await derivedCacheUsage(f.catalog.pool, f.moduleId), reservation);
  } finally {
    restoreUnlink();
  }
  let observedPhysicalRemoval = false;
  const restoreRmdir = patchFs('rmdir', (original) => async (path, ...args) => {
    const result = await original(path, ...args);
    if (String(path) === g.path) {
      await assert.rejects(fs.promises.stat(g.path), { code: 'ENOENT' });
      assert.deepEqual(
        await derivedCacheUsage(f.catalog.pool, f.moduleId),
        reservation,
        'charge must still exist after physical removal, before metadata deletion',
      );
      observedPhysicalRemoval = true;
    }
    return result;
  });
  try {
    await collector.reconcile();
  } finally {
    restoreRmdir();
  }
  assert.equal(observedPhysicalRemoval, true);
  await assert.rejects(fs.promises.stat(g.path), { code: 'ENOENT' });
  assert.deepEqual(await derivedCacheUsage(f.catalog.pool, f.moduleId), { bytes: 0, files: 0 });
  await collector.reconcile();
  assert.deepEqual(await derivedCacheUsage(f.catalog.pool, f.moduleId), { bytes: 0, files: 0 });
});

test('derived recovery: cleanup is bounded to 1000 files and resumes after collector restart', async (t) => {
  const budget = { bytes: 1024 * 1024, files: 4096 };
  const f = await cacheFixture(t, budget);
  const writer = f.create().cache;
  const build = await writer.begin('large-orphan', budget, signal);
  assert.ok(build);
  for (let i = 0; i < 4093; i++) {
    const sink = await build.create(`file-${i}`);
    await sink.close(); // Real core publication, not synthetic filenames injected into its namespace.
  }
  await assert.rejects(build.create('over-limit'), { code: 'module_quota_exceeded' });
  const g = await generation(f, 'large-orphan');
  assert.equal((await fs.promises.readdir(g.path)).length, 4093);
  await writer.close();
  const collector = f.create().cache;
  let removed = 0;
  const restore = patchFs('unlink', (original) => async (path, ...args) => {
    const result = await original(path, ...args);
    if (dirname(String(path)) === g.path) removed++;
    return result;
  });
  try {
    await collector.reconcile();
  } finally {
    restore();
  }
  assert.equal(removed, 1000);
  assert.equal((await fs.promises.readdir(g.path)).length, 3093);
  assert.equal((await generation(f, 'large-orphan')).state, 'deleting');
  assert.deepEqual(await derivedCacheUsage(f.catalog.pool, f.moduleId), budget);
  await collector.close(); // Interrupt between bounded passes; no in-memory cursor survives.
  const restarted = f.create().cache;
  for (const remaining of [2093, 1093, 93]) {
    await restarted.reconcile();
    assert.equal((await fs.promises.readdir(g.path)).length, remaining);
    assert.deepEqual(await derivedCacheUsage(f.catalog.pool, f.moduleId), budget);
  }
  await restarted.reconcile();
  await assert.rejects(fs.promises.stat(g.path), { code: 'ENOENT' });
  assert.deepEqual(await derivedCacheUsage(f.catalog.pool, f.moduleId), { bytes: 0, files: 0 });
});

async function migrationFixture(t) {
  const connectionString = process.env.ARKVORY_TEST_DATABASE_URL;
  if (!connectionString) throw new Error('ARKVORY_TEST_DATABASE_URL is required');
  const admin = new Pool({ connectionString, connectionTimeoutMillis: 5000 });
  const schema = `arkvory_cache_upgrade_${randomUUID().replaceAll('-', '')}`;
  const directory = await fs.promises.mkdtemp(join(tmpdir(), 'arkvory-cache-upgrade-'));
  const url = new URL(connectionString);
  url.searchParams.set('options', `-c search_path=${schema}`);
  const pool = new Pool({
    connectionString: url.toString(),
    max: 10,
    connectionTimeoutMillis: 5000,
  });
  const closers = [];
  t.after(async () => {
    try {
      const failures = [];
      for (const close of closers.reverse()) {
        try {
          await close();
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length) throw new AggregateError(failures, 'upgrade fixture cleanup');
    } finally {
      await pool.end();
      try {
        await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      } finally {
        await admin.end();
        await removeTestDirectory(directory);
      }
    }
  });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const moduleId = 'cache-upgrade';
  const quota = { bytes: 65536, files: 16 };
  const legacy = async (shared) => {
    const coordinator = new PostgresModuleDataCoordinator(pool);
    closers.push(() => coordinator.close());
    const data = await openModuleData({
      dataDirectory: directory,
      moduleId,
      quota,
      reserve: { bytes: 0, inodes: 0 },
      readOnly: false,
      coordinator,
      ...(shared ? { reservedUsage: () => derivedCacheUsage(pool, moduleId) } : {}),
    });
    closers.push(() => data.close());
    return {
      data,
      close: async () => {
        await data.close();
        await coordinator.close();
      },
    };
  };
  const cache = () => {
    const instance = new ModuleDerivedCache({
      pool,
      dataDirectory: directory,
      moduleId,
      quota,
      reserve: { bytes: 0, inodes: 0 },
      readOnly: false,
    });
    closers.push(() => instance.close());
    return instance;
  };
  return { pool, directory, moduleId, quota, legacy, cache };
}

async function readAll(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

test('derived upgrade: migration 48 to 49 preserves legacy cache and isolates generations across reopen', async (t) => {
  const f = await migrationFixture(t);
  await migrate(f.pool, { upTo: 48 });
  assert.equal(
    (await f.pool.query('SELECT max(version) AS version FROM arkvory_migrations')).rows[0].version,
    48,
  );
  assert.equal(
    (await f.pool.query("SELECT to_regclass('arkvory_derived_cache_generations') AS relation"))
      .rows[0].relation,
    null,
  );
  const old = await f.legacy(false);
  const legacyBytes = Buffer.alloc(4096, 73);
  const sink = await old.data.directory.cache.create('legacy', { durable: true, exclusive: false });
  await sink.write(legacyBytes);
  await sink.close();
  await old.close(); // Quiesce old writers before enabling shared quota; no destructive downgrade.
  await migrate(f.pool, { upTo: 49 });
  await migrate(f.pool, { upTo: 49 });
  assert.equal(
    (await f.pool.query('SELECT max(version) AS version FROM arkvory_migrations')).rows[0].version,
    49,
  );
  const first = f.cache();
  assert.equal(
    await first.begin('too-large', f.quota, signal),
    null,
    'legacy bytes survive migration in admission ledger',
  );
  const budget = { bytes: f.quota.bytes - legacyBytes.length, files: 8 };
  const build = await first.begin('group', budget, signal);
  assert.ok(build);
  const payload = Buffer.alloc(4096, 91);
  const file = await build.create('data');
  await file.write(payload);
  await file.close();
  await build.commit(signal);
  const usage = await derivedCacheUsage(f.pool, f.moduleId);
  assert.ok(usage.bytes >= payload.length);
  await first.close();
  const reopened = f.cache();
  const legacy = await f.legacy(true);
  assert.deepEqual(await readAll(legacy.data.directory.cache.read('legacy')), legacyBytes);
  assert.deepEqual((await legacy.data.directory.cache.list('', null, 100)).items, ['legacy']);
  const generation = (
    await f.pool.query('SELECT id FROM arkvory_derived_cache_generations WHERE module_id=$1', [
      f.moduleId,
    ])
  ).rows[0].id;
  const escaped = `../../module-derived-cache/${f.moduleId}/${generation}/manifest`;
  await assert.rejects(legacy.data.directory.cache.stat(escaped), { code: 'invalid_input' });
  await assert.rejects(legacy.data.directory.cache.remove(escaped), { code: 'invalid_input' });
  const reader = await reopened.open('group', signal);
  assert.ok(reader);
  try {
    assert.deepEqual(await readAll(reader.read('data')), payload);
    assert.equal(await reopened.begin('still-too-large', f.quota, signal), null);
    const extra = await legacy.data.directory.cache.create('excess', {
      durable: true,
      exclusive: false,
    });
    try {
      await assert.rejects(extra.write(Buffer.alloc(f.quota.bytes - legacyBytes.length)), {
        code: 'module_quota_exceeded',
      });
    } finally {
      await extra.abort();
    }
    assert.deepEqual(await derivedCacheUsage(f.pool, f.moduleId), usage);
    assert.deepEqual(await readAll(reader.read('data')), payload);
  } finally {
    await reader.release();
  }
});
