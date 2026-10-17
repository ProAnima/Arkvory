import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { PostgresModulePlan, parseModuleSelections } from '@proanima/arkvory-infrastructure';
import { createServer } from '../../apps/api/dist/index.js';
import { setup } from './fixture.mjs';

const withoutProtocols = parseModuleSelections({
  format: 1,
  modules: { npm: { enabled: false }, oci: { enabled: false }, lfs: { enabled: false } },
});
const policy = { slots: 3, slot: 0, bytesPerSecond: 262144, perPrincipalBytesPerSecond: 262144 };

async function fixture(t, overrides = {}) {
  const cleanup = [];
  t.after(async () => {
    for (const close of cleanup.reverse()) await close();
  });
  const f = await setup({ after: (close) => cleanup.push(close) }, overrides);
  return { ...f, cleanup };
}

async function reader(f, slot, modules) {
  const gateway = await createServer({
    ...f.config,
    role: 'reader',
    sharedDownloads: { ...policy, slot },
    ...(modules ? { modules } : {}),
  });
  f.cleanup.push(() => gateway.close());
  return gateway;
}

test('the writer records its plan; a read gateway with another plan is not ready', async (t) => {
  const f = await fixture(t, { sharedDownloads: policy });
  const fingerprint = (
    await f.app.inject({ url: '/api/v1/system/modules', headers: f.headers })
  ).json().fingerprint;
  const recorded = new PostgresModulePlan(f.catalog.pool);
  assert.equal(await recorded.read(), fingerprint);

  const same = await reader(f, 1);
  assert.equal((await same.inject({ url: '/health/status' })).json().status, 'ready');
  assert.equal(
    (await same.inject({ url: '/health/ready', headers: f.headers })).json().status,
    'ready',
  );

  const other = await reader(f, 2, withoutProtocols);
  const status = await other.inject({ url: '/health/status' });
  assert.equal(status.statusCode, 503);
  assert.deepEqual(status.json(), { status: 'unavailable' });
  const ready = await other.inject({ url: '/health/ready', headers: f.headers });
  assert.equal(ready.statusCode, 503);
  assert.equal(ready.json().code, 'unavailable');
  assert.equal(ready.json().reason, 'module_plan_mismatch');
  // Its own surface still follows its plan; the operator restarts it with the installation's.
  assert.equal(
    (await other.inject({ url: '/npm/releases/x', headers: f.headers })).statusCode,
    404,
  );

  // The writer restarted with the gateway's plan: the gateway becomes ready again.
  f.config.modules = withoutProtocols;
  await f.restart();
  assert.notEqual(await recorded.read(), fingerprint);
  await delay(1100);
  assert.equal((await other.inject({ url: '/health/status' })).json().status, 'ready');
  assert.equal((await same.inject({ url: '/health/status' })).statusCode, 503);
});

test('a worker with another module plan takes no work until the plans agree', async (t) => {
  const f = await fixture(t);
  const keys = join(f.directory, 'worker-keys.json');
  await writeFile(
    keys,
    JSON.stringify(f.config.keys.map((key) => ({ ...key.principal, sha256: key.sha256 }))),
  );
  const file = join(f.directory, 'modules.json');
  await writeFile(file, JSON.stringify({ format: 1, modules: { npm: { enabled: false } } }));
  const child = spawn(process.execPath, ['apps/worker/dist/main.js'], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ARKVORY_DATABASE_URL: f.config.databaseUrl,
      ARKVORY_DATA_DIR: f.directory,
      ARKVORY_KEYS_FILE: keys,
      ARKVORY_MODULES_FILE: file,
    },
  });
  const ended = once(child, 'exit');
  let output = '';
  const keep = (chunk) => {
    output = (output + chunk).slice(-32768);
  };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  f.cleanup.push(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await ended;
    }
  });
  const deadline = performance.now() + 20000;
  while (!output.includes('worker.module_plan_mismatch') && performance.now() < deadline)
    await delay(100);
  assert.match(output, /worker\.module_plan_mismatch/);
  assert.doesNotMatch(output, /worker\.started/);
  assert.equal(child.exitCode, null, 'the worker waits instead of exiting');
  // The writer restarts with the worker's plan; the worker starts within its retry pause.
  f.config.modules = parseModuleSelections({ format: 1, modules: { npm: { enabled: false } } });
  await f.restart();
  const started = performance.now() + 20000;
  while (!output.includes('worker.started') && performance.now() < started) await delay(100);
  assert.match(output, /worker\.started/);
  assert.equal(output.match(/worker\.module_plan_mismatch/g)?.length, 1, 'reported once');
});
