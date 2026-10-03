import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { setup } from './fixture.mjs';

async function fixture(t) {
  const cleanup = [];
  t.after(async () => {
    for (const action of cleanup.reverse()) await action();
  });
  return { ...(await setup({ after: (action) => cleanup.push(action) })), cleanup };
}

/** A production worker process of this installation; its output is kept for assertions. */
async function worker(f, keys) {
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
  const process_ = { child, output: '', ended: once(child, 'exit') };
  const keep = (chunk) => {
    process_.output = (process_.output + chunk).slice(-32768);
  };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  f.cleanup.push(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await process_.ended;
    }
  });
  return process_;
}

/** The backend PID holding the completion worker's lock, or null. */
async function lockHolder(f) {
  const row = (
    await f.catalog.pool.query(`SELECT pid FROM pg_locks WHERE locktype='advisory'
      AND classid=18471 AND objid=6 AND objsubid=2 AND granted
      AND database=(SELECT oid FROM pg_database WHERE datname=current_database())`)
  ).rows[0];
  return row?.pid ?? null;
}
async function until(condition, what, ms = 20000) {
  const deadline = performance.now() + ms;
  while (performance.now() < deadline) {
    const value = await condition();
    if (value) return value;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

test('a second worker waits as standby and takes over when the first one stops', async (t) => {
  const f = await fixture(t);
  const keys = join(f.directory, 'worker-keys.json');
  await writeFile(
    keys,
    JSON.stringify(f.config.keys.map((key) => ({ ...key.principal, sha256: key.sha256 }))),
  );
  const first = await worker(f, keys);
  const firstPid = await until(() => lockHolder(f), 'the first worker to take the lock');
  const second = await worker(f, keys);
  await until(() => second.output.includes('worker.standby'), 'the standby report');
  await delay(1500);
  assert.equal(second.child.exitCode, null, `the standby keeps running: ${second.output}`);
  assert.equal(await lockHolder(f), firstPid, 'the first worker keeps the lock');
  assert.equal(
    second.output.match(/worker\.standby/g)?.length,
    1,
    'standby is reported once, not per retry',
  );

  // The first worker goes away; the standby takes the lock within its retry interval.
  first.child.kill('SIGKILL');
  await first.ended;
  const secondPid = await until(async () => {
    const pid = await lockHolder(f);
    return pid !== null && pid !== firstPid ? pid : null;
  }, 'the standby to take over');
  assert.ok(secondPid);
  await until(() => second.output.includes('worker.started'), 'the standby to start');
  assert.equal(second.child.exitCode, null, second.output);
});
