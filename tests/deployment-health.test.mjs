import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Services } from '../apps/deploy/dist/services.js';
import { DeploymentCommandTimeout } from '../apps/deploy/dist/process.js';
import { exclusive } from '../apps/deploy/dist/files.js';
import { removeTestDirectory } from './helpers.mjs';

async function fixture(t, failure) {
  const directory = await mkdtemp(join(tmpdir(), 'arkvory-health-'));
  t.after(() => removeTestDirectory(directory));
  await mkdir(join(directory, 'config'));
  await writeFile(join(directory, 'config/runtime.json'), '{}');
  await writeFile(join(directory, 'config/health-token.txt'), 'a'.repeat(64));
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 200 }));
  const services = new Services(directory, { mode: 'systemd' });
  let calls = 0;
  // Exercise the real readiness loop without invoking the host's service manager.
  t.mock.method(services, 'workerRunning', async () => {
    calls++;
    if (calls === 1) throw failure;
  });
  return { directory, services, calls: () => calls };
}

for (const wrapped of [false, true]) {
  test(`readiness preserves unconfirmed termination and operation lock (wrapped=${wrapped})`, async (t) => {
    const timeout = new DeploymentCommandTimeout(false);
    const failure = wrapped ? new Error('Worker probe failed', { cause: timeout }) : timeout;
    const { directory, services, calls } = await fixture(t, failure);
    await assert.rejects(
      exclusive(directory, () => services.healthy()),
      (error) => error === failure,
    );
    assert.equal(calls(), 1, 'An uncertain probe must never be retried');
    await access(join(directory, 'operation.lock'));
  });
}

for (const confirmedTimeout of [false, true]) {
  test(`readiness retries a safely failed worker probe (confirmedTimeout=${confirmedTimeout})`, async (t) => {
    const failure = confirmedTimeout
      ? new DeploymentCommandTimeout(true)
      : new Error('Worker is still starting');
    const { directory, services, calls } = await fixture(t, failure);
    await exclusive(directory, () => services.healthy());
    assert.equal(calls(), 2);
    await assert.rejects(access(join(directory, 'operation.lock')), { code: 'ENOENT' });
  });
}
