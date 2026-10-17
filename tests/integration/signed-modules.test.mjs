import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ArkvoryClient } from '@proanima/arkvory-sdk';
import { parseModuleSelections } from '@proanima/arkvory-infrastructure';
import { createServer } from '../../apps/api/dist/index.js';
import { planApiModules } from '../../apps/api/dist/modules.js';
import { setup } from './fixture.mjs';
import { validateResponse } from '../api-schema.mjs';
import { moduleInstallation, modulePackage, revocationList } from '../module-fixtures.mjs';

const URL = '/api/v1/system/modules';
const enable = (...ids) =>
  parseModuleSelections({
    format: 1,
    modules: Object.fromEntries(ids.map((id) => [id, { enabled: true }])),
  });

async function fixture(t, overrides) {
  const cleanup = [];
  t.after(async () => {
    for (const close of cleanup.reverse()) await close();
  });
  const f = await setup({ after: (close) => cleanup.push(close) }, overrides);
  // Not spread: `app` is a getter that follows restarts.
  return Object.assign(f, { cleanup });
}

const listed = async (f) => {
  const answer = await f.app.inject({ url: URL, headers: f.headers });
  validateResponse(URL, 'get', answer);
  return Object.fromEntries(answer.json().modules.map((m) => [m.id, m]));
};

test('a module installed by arkvory module install is loaded by the API and its read gateways', async (t) => {
  const host = await moduleInstallation(t);
  await host.install(modulePackage(host.keys.module, { id: 'ledger', kind: 'event-sink' }));
  const policy = { slots: 2, slot: 0, bytesPerSecond: 131072, perPrincipalBytesPerSecond: 131072 };
  const f = await fixture(t, {
    installedModules: host.source(),
    modules: enable('ledger'),
    sharedDownloads: policy,
  });
  const ledger = (await listed(f)).ledger;
  assert.deepEqual(ledger, {
    id: 'ledger',
    version: '1.0.0',
    kind: 'event-sink',
    source: 'signed',
    core: false,
    enabled: true,
    roles: ['api', 'reader'],
    running: true,
    health: { status: 'ok', code: null },
  });
  const ready = await f.app.inject({ url: '/health/ready', headers: f.headers });
  assert.equal(ready.statusCode, 200, ready.body);
  const capabilities = await f.app.inject({ url: '/api/v1/capabilities', headers: f.headers });
  assert.ok(capabilities.json().modules.some((m) => m.id === 'ledger' && m.kind === 'event-sink'));
  const metrics = (await f.app.inject({ url: '/health/metrics', headers: f.headers })).body;
  assert.match(
    metrics,
    /^arkvory_module_info\{module="ledger",kind="event-sink",source="signed"\} 1$/m,
  );
  assert.match(metrics, /^arkvory_module_up\{module="ledger"\} 1$/m);

  // The signed module is part of the installation's plan: the built-in plan alone differs.
  const plan = (await f.app.inject({ url: URL, headers: f.headers })).json();
  assert.notEqual(
    plan.compatibilityFingerprint,
    planApiModules('api', 'dev').plan.compatibilityFingerprint,
  );
  // A read gateway of the same host loads the same module and agrees with the writer.
  const reader = await createServer({
    ...f.config,
    role: 'reader',
    sharedDownloads: { ...policy, slot: 1 },
  });
  f.cleanup.push(() => reader.close());
  const gateway = (await reader.inject({ url: URL, headers: f.headers })).json();
  assert.equal(gateway.compatibilityFingerprint, plan.compatibilityFingerprint);
  assert.equal(gateway.modules.find((m) => m.id === 'ledger').running, true);
  assert.equal((await reader.inject({ url: '/health/ready', headers: f.headers })).statusCode, 200);

  const origin = await f.listen();
  const client = new ArkvoryClient(origin, () => f.headers.authorization.slice(7));
  assert.deepEqual(await client.system.modules(), plan);

  // Installed but not enabled: planned and listed, not run.
  Object.assign(f.config, { modules: undefined });
  await f.restart();
  const idle = (await listed(f)).ledger;
  assert.deepEqual([idle.enabled, idle.running, idle.health], [false, false, null]);
});

test('refused and failing modules keep the API serving by the readiness rules', async (t) => {
  const host = await moduleInstallation(t);
  const { module } = host.keys;
  await host.install(modulePackage(module, { id: 'steady' }));
  await host.install(modulePackage(module, { id: 'changed' }));
  await host.install(modulePackage(module, { id: 'withdrawn' }));
  await host.install(
    modulePackage(module, { id: 'feeder', provides: ['feed'] }, { startFails: true }),
  );
  await host.install(modulePackage(module, { id: 'reporter', requires: ['feed'] }));
  await host.install(
    modulePackage(
      module,
      { id: 'storer', provides: ['blobs'], dataClass: 'layout' },
      { startFails: true },
    ),
  );
  await host.install(modulePackage(module, { id: 'archiver', requires: ['blobs'] }));
  await writeFile(join(host.modules, 'changed/1.0.0/files/main.mjs'), 'export default {};\n');
  const list = revocationList(module, {
    sequence: 2,
    entries: [
      {
        id: 'withdrawn',
        versions: ['1.0.0'],
        reason: 'unsafe_read',
        readOnly: false,
        replacement: null,
      },
    ],
  });
  await host.run('revocations', await host.writeFileIn('revocations.json', list));

  const f = await fixture(t, {
    installedModules: host.source(),
    modules: enable('steady', 'changed', 'withdrawn'),
  });
  let modules = await listed(f);
  assert.deepEqual(modules.changed.health, { status: 'failed', code: 'file_mismatch' });
  assert.deepEqual([modules.changed.kind, modules.changed.running], ['unknown', false]);
  assert.deepEqual(modules.withdrawn.health, { status: 'revoked', code: 'unsafe_read' });
  assert.equal(modules.steady.running, true);
  // Optional modules failing never take the process out of readiness.
  assert.equal((await f.app.inject({ url: '/health/ready', headers: f.headers })).statusCode, 200);

  // A provider that fails to start while an enabled module requires it: not ready.
  Object.assign(f.config, { modules: enable('feeder', 'reporter') });
  await f.restart();
  modules = await listed(f);
  assert.deepEqual(modules.feeder.health, { status: 'failed', code: 'start_failed' });
  assert.deepEqual(modules.reporter.health, { status: 'failed', code: 'requirement_failed' });
  const blocked = await f.app.inject({ url: '/health/ready', headers: f.headers });
  assert.equal(blocked.statusCode, 503);
  assert.equal(blocked.json().reason, 'module_failed');
  assert.equal((await f.app.inject({ url: '/health/status' })).statusCode, 503);
  // Data of the core stays served: the catalog answers while the process is not ready.
  const repositories = await f.app.inject({ url: '/api/v1/repositories', headers: f.headers });
  assert.equal(repositories.statusCode, 200, repositories.body);

  // The same failure of a module that stores published bytes keeps the process ready
  // (ADR 0078, I1): new uploads go to the core's storage, its own data stays readable.
  Object.assign(f.config, { modules: enable('storer', 'archiver') });
  await f.restart();
  modules = await listed(f);
  assert.deepEqual(modules.storer.health, { status: 'failed', code: 'start_failed' });
  assert.equal((await f.app.inject({ url: '/health/ready', headers: f.headers })).statusCode, 200);
});
