import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  PostgresModulePlan,
  parseModuleSelections,
  processIdentity,
} from '@proanima/arkvory-infrastructure';
import { createServer } from '../../apps/api/dist/index.js';
import { setup } from './fixture.mjs';

const withoutProtocols = parseModuleSelections({
  format: 1,
  modules: { npm: { enabled: false }, oci: { enabled: false }, lfs: { enabled: false } },
});
const policy = { slots: 3, slot: 0, bytesPerSecond: 262144, perPrincipalBytesPerSecond: 262144 };

async function fixture(t, overrides = {}, lifecycle = {}) {
  const cleanup = [];
  t.after(async () => {
    for (const close of cleanup.reverse()) await close();
  });
  const f = await setup({ after: (close) => cleanup.push(close) }, overrides, lifecycle);
  return { ...f, cleanup };
}

/** A process of a staged release: the version its release manifest would give it. */
const release = (version) => ({ identity: processIdentity('api', version) });

async function reader(f, slot, modules, lifecycle = {}) {
  const gateway = await createServer(
    {
      ...f.config,
      role: 'reader',
      sharedDownloads: { ...policy, slot },
      ...(modules ? { modules } : {}),
    },
    lifecycle,
  );
  f.cleanup.push(() => gateway.close());
  return gateway;
}

test('the writer records its plan; a read gateway with another plan is not ready', async (t) => {
  const f = await fixture(t, { sharedDownloads: policy });
  const { compatibilityFingerprint, fingerprint } = (
    await f.app.inject({ url: '/api/v1/system/modules', headers: f.headers })
  ).json();
  const recorded = new PostgresModulePlan(f.catalog.pool);
  assert.deepEqual(await recorded.read(), { compatibilityFingerprint, fingerprint });

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
  assert.notEqual((await recorded.read()).compatibilityFingerprint, compatibilityFingerprint);
  await delay(1100);
  assert.equal((await other.inject({ url: '/health/status' })).json().status, 'ready');
  assert.equal((await same.inject({ url: '/health/status' })).statusCode, 503);
});

test('a read gateway of another release with the same modules serves beside the writer', async (t) => {
  // A rolling update without a migration: the writer runs 1.6.1, the gateway is still 1.6.0.
  const f = await fixture(t, { sharedDownloads: policy }, release('1.6.1'));
  const writer = (await f.app.inject({ url: '/api/v1/system/modules', headers: f.headers })).json();
  const previous = await reader(f, 1, undefined, release('1.6.0'));
  assert.equal((await previous.inject({ url: '/health/status' })).json().status, 'ready');
  const ready = await previous.inject({ url: '/health/ready', headers: f.headers });
  assert.equal(ready.statusCode, 200, ready.body);
  const gateway = (
    await previous.inject({ url: '/api/v1/system/modules', headers: f.headers })
  ).json();
  assert.ok(gateway.modules.every((m) => m.version === '1.6.0'));
  assert.ok(writer.modules.every((m) => m.version === '1.6.1'));
  assert.equal(gateway.compatibilityFingerprint, writer.compatibilityFingerprint);
  assert.notEqual(gateway.fingerprint, writer.fingerprint, 'the full fingerprint names the build');
  assert.deepEqual(await new PostgresModulePlan(f.catalog.pool).read(), {
    compatibilityFingerprint: writer.compatibilityFingerprint,
    fingerprint: writer.fingerprint,
  });

  // Another release that also enables other modules is still a disagreement.
  const disagreeing = await reader(f, 2, withoutProtocols, release('1.6.0'));
  const refused = await disagreeing.inject({ url: '/health/ready', headers: f.headers });
  assert.equal(refused.statusCode, 503);
  assert.equal(refused.json().reason, 'module_plan_mismatch');
  assert.equal((await disagreeing.inject({ url: '/health/status' })).statusCode, 503);
});

/** A production worker process of this installation; its output is kept for assertions. */
async function worker(f, modulesFile) {
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
      ...(modulesFile ? { ARKVORY_MODULES_FILE: modulesFile } : {}),
    },
  });
  const process_ = { child, output: '' };
  const ended = once(child, 'exit');
  const keep = (chunk) => {
    process_.output = (process_.output + chunk).slice(-32768);
  };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  f.cleanup.push(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await ended;
    }
  });
  return process_;
}

async function until(condition, what, ms = 20000) {
  const deadline = performance.now() + ms;
  while (!condition()) {
    if (performance.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await delay(100);
  }
}

async function npmOff(f) {
  const file = join(f.directory, 'modules.json');
  await writeFile(file, JSON.stringify({ format: 1, modules: { npm: { enabled: false } } }));
  return file;
}

test('a worker with another module plan takes no work until the plans agree', async (t) => {
  const f = await fixture(t);
  const waiting = await worker(f, await npmOff(f));
  await until(() => waiting.output.includes('worker.module_plan_mismatch'), 'the mismatch');
  assert.doesNotMatch(waiting.output, /worker.started/);
  assert.equal(waiting.child.exitCode, null, 'the worker waits instead of exiting');
  // The writer restarts with the worker's plan; the worker starts within its retry pause.
  f.config.modules = parseModuleSelections({ format: 1, modules: { npm: { enabled: false } } });
  await f.restart();
  await until(() => waiting.output.includes('worker.started'), 'the start', 20000);
  assert.equal(waiting.output.match(/worker.module_plan_mismatch/g)?.length, 1, 'reported once');
});

test('a worker waiting for its plan leaves the lock to a standby with the writer plan', async (t) => {
  const f = await fixture(t);
  const waiting = await worker(f, await npmOff(f));
  await until(() => waiting.output.includes('worker.module_plan_mismatch'), 'the mismatch');
  // Without a file the second worker plans what the writer recorded: it takes over the work.
  const matching = await worker(f);
  await until(() => matching.output.includes('worker.started'), 'the matching worker', 20000);
  assert.doesNotMatch(waiting.output, /worker.started/);
  assert.equal(waiting.child.exitCode, null, `the waiting worker keeps waiting: ${waiting.output}`);
});

test('a worker of another release with the writer plan takes the work', async (t) => {
  // The writer runs release 1.6.1; the worker of this checkout is a development build (`dev`).
  const f = await fixture(t, {}, release('1.6.1'));
  const running = await worker(f);
  await until(() => running.output.includes('worker.started'), 'the start', 20000);
  assert.doesNotMatch(running.output, /worker.module_plan_mismatch/);
});
