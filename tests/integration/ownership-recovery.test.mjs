import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { setup } from './fixture.mjs';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

test('lost ownership requests one supervised shutdown and fresh startup recovers', async (t) => {
  let notifications = 0;
  let closed;
  const f = await setup(
    t,
    {},
    {
      onOwnershipLost: () => {
        notifications++;
        closed = f.app.close();
      },
    },
  );
  await f.listen();
  const killed = await f.catalog.pool
    .query(`SELECT pg_terminate_backend(pid) AS killed FROM pg_locks
    WHERE locktype='advisory' AND classid=18471 AND objid=3 AND objsubid=2 AND granted
    AND database=(SELECT oid FROM pg_database WHERE datname=current_database())`);
  assert.equal(killed.rows.length, 1);
  assert.equal(killed.rows[0].killed, true);
  for (let attempt = 0; attempt < 50 && notifications === 0; attempt++) await delay(100);
  assert.equal(notifications, 1, 'Fenced API must notify its process owner');
  await closed;
  assert.equal(f.app.server.listening, false);
  await f.restart();
  assert.equal((await f.app.inject({ url: '/health/ready', headers: f.headers })).statusCode, 200);
  await f.app.close();
  await delay(1200);
  assert.equal(notifications, 1, 'Intentional close must not trigger failure recovery');
});

test('production API exits with failure after fencing and a new process becomes ready', async (t) => {
  const f = await setup(t);
  const address = await f.listen();
  await f.app.close();
  const keys = join(f.directory, 'recovery-keys.json');
  await writeFile(
    keys,
    JSON.stringify(f.config.keys.map(({ sha256, principal }) => ({ sha256, ...principal }))),
    { mode: 0o600 },
  );
  const env = {
    ...process.env,
    ARKVORY_DATABASE_URL: f.config.databaseUrl,
    ARKVORY_DATA_DIR: f.directory,
    ARKVORY_KEYS_FILE: keys,
    ARKVORY_HOST: '127.0.0.1',
    ARKVORY_PORT: new URL(address).port,
  };
  const start = () =>
    spawn(process.execPath, ['apps/api/dist/main.js'], {
      env,
      windowsHide: true,
      stdio: 'ignore',
    });
  const wait = async (predicate) => {
    for (let attempt = 0; attempt < 150; attempt++) {
      if (await predicate()) return;
      await delay(100);
    }
    throw Error('Production recovery timed out');
  };
  const ready = async () => {
    try {
      const response = await fetch(address + '/health/ready', {
        headers: f.headers,
        signal: AbortSignal.timeout(1000),
      });
      await response.body?.cancel();
      return response.ok;
    } catch {
      return false;
    }
  };
  let child = start();
  try {
    await wait(ready);
    const result = await f.catalog.pool
      .query(`SELECT pg_terminate_backend(pid) AS killed FROM pg_locks
      WHERE locktype='advisory' AND classid=18471 AND objid=3 AND objsubid=2 AND granted
      AND database=(SELECT oid FROM pg_database WHERE datname=current_database())`);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].killed, true);
    await wait(() => child.exitCode !== null || child.signalCode !== null);
    assert.equal(child.exitCode, 1, 'SCM must observe an unsuccessful process exit');
    child = start();
    await wait(ready);
    assert.equal(child.exitCode, null);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await wait(() => child.exitCode !== null || child.signalCode !== null);
    }
  }
});
