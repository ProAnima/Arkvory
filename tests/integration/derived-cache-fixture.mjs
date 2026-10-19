import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { ModuleDerivedCache } from '@proanima/arkvory-infrastructure';
import { setup } from './fixture.mjs';

export const signal = new AbortController().signal;
export const reservation = { bytes: 65536, files: 8 };

/** Real migrated PG schema and disk; independent pools identify only this test's owners. */
export async function cacheFixture(t, quota = reservation) {
  const fixtureCleanups = [];
  let f;
  try {
    f = await setup({ after: (cleanup) => fixtureCleanups.push(cleanup) });
  } catch (error) {
    const results = await Promise.allSettled(fixtureCleanups.map((cleanup) => cleanup()));
    const failures = results.filter((r) => r.status === 'rejected').map((r) => r.reason);
    if (failures.length) throw new AggregateError([error, ...failures], 'cache fixture setup');
    throw error;
  }
  const instances = [];
  const beforeClose = [];
  const moduleId = `cache-${randomUUID().replaceAll('-', '').slice(0, 20)}`;
  const create = (readOnly = false) => {
    const applicationName = `derived-test-${randomUUID()}`;
    const pool = new Pool({
      connectionString: f.config.databaseUrl,
      application_name: applicationName,
      max: 6,
      connectionTimeoutMillis: 5000,
      statement_timeout: 10000,
    });
    // A revoked idle owner session must not become an unhandled Pool error in the harness.
    const poolErrors = [];
    pool.on('error', (error) => poolErrors.push(error));
    const cache = new ModuleDerivedCache({
      pool,
      dataDirectory: f.directory,
      moduleId,
      quota,
      reserve: { bytes: 0, inodes: 0 },
      readOnly,
    });
    const instance = { cache, pool, applicationName, poolErrors };
    instances.push(instance);
    return instance;
  };
  // setup owns schema/FS cleanup. Close sessions first, even when an assertion fails.
  t.after(async () => {
    const before = await Promise.allSettled(beforeClose.map((close) => close()));
    const results = await Promise.allSettled(
      instances.map(async ({ cache, pool }) => {
        try {
          await cache.close();
        } finally {
          await pool.end();
        }
      }),
    );
    for (const cleanup of fixtureCleanups) {
      try {
        await cleanup();
      } catch (reason) {
        results.push({ status: 'rejected', reason });
      }
    }
    const failures = [...before, ...results].filter((r) => r.status === 'rejected');
    if (failures.length)
      throw new AggregateError(
        failures.map((r) => r.reason),
        'cache cleanup',
      );
  });
  const terminate = async (instance) => {
    const rows = await f.catalog.pool.query(
      `SELECT pid FROM pg_stat_activity WHERE application_name=$1
       AND datname=current_database() AND pid<>pg_backend_pid()`,
      [instance.applicationName],
    );
    assert.ok(rows.rowCount > 0, 'must revoke an existing owner session, not an empty match');
    for (const { pid } of rows.rows) {
      const result = await f.catalog.pool.query('SELECT pg_terminate_backend($1) AS killed', [pid]);
      assert.equal(result.rows[0].killed, true);
    }
  };
  return { ...f, moduleId, create, terminate, instances, beforeClose };
}

export async function writeBuild(build, values) {
  for (const [name, bytes] of Object.entries(values)) {
    const sink = await build.create(name);
    await sink.write(bytes);
    await sink.close();
  }
}

export async function assertRead(reader, expected) {
  assert.ok(reader, 'published generation must open; miss is not a successful oracle');
  const page = await reader.list(null, 100);
  assert.deepEqual([...page.items].sort(), Object.keys(expected).sort());
  assert.equal(page.next, null);
  for (const [name, bytes] of Object.entries(expected)) {
    assert.deepEqual(await reader.stat(name), { size: bytes.length });
    const chunks = [];
    for await (const part of reader.read(name)) chunks.push(Buffer.from(part));
    assert.deepEqual(Buffer.concat(chunks), bytes, `exact generation bytes: ${name}`);
  }
}
