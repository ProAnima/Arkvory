import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { setTimeout as delay } from 'node:timers/promises';
import {
  PostgresCatalog,
  PostgresContentPins,
  PostgresCleanup,
} from '@proanima/arkvory-infrastructure';
import { databaseProxy } from './database-proxy.mjs';
import { setup } from './fixture.mjs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';

async function fixture(t) {
  const cleanup = [];
  t.after(async () => {
    for (const action of cleanup.reverse()) await action();
  });
  return { ...(await setup({ after: (action) => cleanup.push(action) })), cleanup };
}

test('isolated upload and cleanup sessions stop on partition while the writer stays healthy', async (t) => {
  const f = await fixture(t);
  for (const mode of ['upload', 'cleanup']) {
    const proxy = await databaseProxy(f);
    const isolated = new PostgresCatalog(proxy.url, 1024, 1);
    f.cleanup.push(() => isolated.close());
    const id = randomUUID();
    const run =
      mode === 'upload'
        ? (action) => isolated.exclusive(id, action)
        : (action) => new PostgresCleanup(isolated.pool).exclusive(id, true, action);
    await assert.rejects(
      run(async (protection) => {
        protection.throwIfAborted();
        proxy.stall();
        try {
          await delay(8100);
          assert.equal(
            (await f.app.inject({ url: '/health/ready', headers: f.headers })).statusCode,
            200,
          );
          protection.throwIfAborted();
        } finally {
          proxy.resume();
        }
      }),
      { code: 'unavailable' },
    );
    // A new session can acquire the same object. The previous callback was not allowed to continue.
    await run(async (protection) => {
      protection.throwIfAborted();
    });
  }
});

test('content pins expire independently and recover only after all old readers release', async (t) => {
  const f = await fixture(t),
    proxy = await databaseProxy(f);
  const pool = new Pool({ connectionString: proxy.url });
  f.cleanup.push(() => pool.end());
  const pins = new PostgresContentPins(pool);
  f.cleanup.push(async () => {
    proxy.resume();
    await pins.close();
  });
  const id = randomUUID(),
    first = await pins.acquire(id),
    second = await pins.acquire(id);
  proxy.stall();
  await delay(8100);
  assert.throws(() => first.check(), { code: 'unavailable' });
  await assert.rejects(pins.acquire(id), { code: 'unavailable' });
  proxy.resume();
  await first.release();
  await assert.rejects(pins.acquire(id), { code: 'unavailable' });
  await second.release();
  const next = await pins.acquire(id);
  next.check();
  assert.throws(() => first.check(), { code: 'unavailable' });
  await next.release();
});

test('closing an idle owner on a silent link does not wait for a remote FIN', async (t) => {
  const f = await fixture(t),
    proxy = await databaseProxy(f);
  const catalog = new PostgresCatalog(proxy.url, 1024, 1);
  const storageId = (await f.catalog.pool.query('SELECT storage_id FROM arkvory_storage_identity'))
    .rows[0].storage_id;
  await catalog.claimStorage(storageId, 'worker');
  proxy.stall();
  const before = performance.now();
  try {
    await catalog.close();
  } finally {
    proxy.resume();
  }
  assert(performance.now() - before < 2000, 'idle owner waited for network recovery');
  await assert.rejects(catalog.claimStorage(storageId, 'worker'), { code: 'conflict' });
});

test('idle production worker exits unsuccessfully after its owner connection is terminated', async (t) => {
  const f = await fixture(t);
  const keys = join(f.directory, 'worker-keys.json');
  await writeFile(
    keys,
    JSON.stringify(f.config.keys.map((key) => ({ ...key.principal, sha256: key.sha256 }))),
  );
  const child = spawn(process.execPath, ['apps/worker/dist/main.js'], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ARKVORY_DATABASE_URL: f.config.databaseUrl,
      ARKVORY_DATA_DIR: f.directory,
      ARKVORY_KEYS_FILE: keys,
    },
  });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output = (output + chunk).slice(-16384);
  });
  child.stderr.on('data', (chunk) => {
    output = (output + chunk).slice(-16384);
  });
  const ended = once(child, 'exit');
  f.cleanup.push(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await ended;
    }
  });
  let pid;
  const deadline = performance.now() + 10000;
  while (!pid && performance.now() < deadline) {
    const row = (
      await f.catalog.pool.query(`SELECT pid FROM pg_locks WHERE locktype='advisory'
      AND classid=18471 AND objid=6 AND objsubid=2 AND granted
      AND database=(SELECT oid FROM pg_database WHERE datname=current_database())`)
    ).rows[0];
    pid = row?.pid;
    if (!pid) await delay(50);
  }
  assert(pid, output);
  await f.catalog.pool.query('SELECT pg_terminate_backend($1)', [pid]);
  const [code, signal] = await ended;
  assert.equal(signal, null, output);
  assert.equal(code, 1, output);
  assert.match(output, /worker\.(ownership_lost|unavailable)/);
});
