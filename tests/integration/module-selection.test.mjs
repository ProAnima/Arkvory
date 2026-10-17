import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ArkvoryClient } from '@proanima/arkvory-sdk';
import { parseModuleSelections } from '@proanima/arkvory-infrastructure';
import { createServer, loadConfig } from '../../apps/api/dist/index.js';
import { setup } from './fixture.mjs';
import { validateResponse } from '../api-schema.mjs';

const withoutProtocols = parseModuleSelections({
  format: 1,
  modules: { npm: { enabled: false }, oci: { enabled: false }, lfs: { enabled: false } },
});

async function fixture(t, overrides = {}) {
  const cleanup = [];
  t.after(async () => {
    for (const close of cleanup.reverse()) await close();
  });
  const f = await setup({ after: (close) => cleanup.push(close) }, overrides);
  return { ...f, cleanup };
}

test('disabled protocols register no routes, leave capabilities and stay in the plan', async (t) => {
  const f = await fixture(t, { modules: withoutProtocols });
  for (const [method, url] of [
    ['GET', '/v2/'],
    ['GET', '/npm/releases/left-pad'],
    ['POST', '/lfs/releases/objects/batch'],
  ]) {
    const answer = await f.app.inject({ method, url, headers: f.headers, payload: {} });
    assert.equal(answer.statusCode, 404, `${method} ${url}: ${answer.body}`);
    assert.equal(answer.json().code, 'not_found');
    assert.equal(answer.json().reason, 'route_not_found');
  }
  // Raw files are the free core: still served.
  const raw = await f.app.inject({
    url: '/api/v1/repositories/releases/raw/missing.bin',
    headers: f.headers,
  });
  assert.equal(raw.statusCode, 404);
  assert.notEqual(raw.json().reason, 'route_not_found');

  const capabilities = await f.app.inject({ url: '/api/v1/capabilities', headers: f.headers });
  validateResponse('/api/v1/capabilities', 'get', capabilities);
  assert.deepEqual(capabilities.json().modules, [
    { id: 'raw', kind: 'protocol' },
    { id: 'upack', kind: 'protocol' },
  ]);
  const modules = (
    await f.app.inject({ url: '/api/v1/system/modules', headers: f.headers })
  ).json();
  assert.deepEqual(
    modules.modules.map((m) => [m.id, m.enabled, m.running, m.health]),
    [
      ['lfs', false, false, null],
      ['npm', false, false, null],
      ['oci', false, false, null],
      ['raw', true, true, { status: 'ok', code: null }],
      ['upack', true, true, { status: 'ok', code: null }],
    ],
  );
  const metrics = (await f.app.inject({ url: '/health/metrics', headers: f.headers })).body;
  assert.match(
    metrics,
    /^arkvory_module_info\{module="raw",kind="protocol",source="builtin"\} 1$/m,
  );
  assert.match(metrics, /^arkvory_module_up\{module="upack"\} 1$/m);
  assert.doesNotMatch(metrics, /arkvory_module_(info|up)\{module="(npm|oci|lfs)"/);

  const origin = await f.listen();
  const client = new ArkvoryClient(origin, () => f.headers.authorization.slice(7));
  assert.deepEqual((await client.capabilities()).modules, capabilities.json().modules);
});

test('by default every built-in protocol is served, listed and measured', async (t) => {
  const f = await fixture(t);
  const capabilities = await f.app.inject({ url: '/api/v1/capabilities', headers: f.headers });
  assert.deepEqual(
    capabilities.json().modules.map((m) => m.id),
    ['lfs', 'npm', 'oci', 'raw', 'upack'],
  );
  assert.equal((await f.app.inject({ url: '/v2/', headers: f.headers })).statusCode, 200);
  const metrics = (await f.app.inject({ url: '/health/metrics', headers: f.headers })).body;
  for (const id of ['lfs', 'npm', 'oci', 'raw', 'upack'])
    assert.match(metrics, new RegExp(`^arkvory_module_up\\{module="${id}"\\} 1$`, 'm'));
});

test('ARKVORY_MODULES_FILE is read by loadConfig; an unknown module stops the start', async (t) => {
  const f = await fixture(t);
  const keys = join(f.directory, 'keys.json');
  await writeFile(
    keys,
    JSON.stringify(f.config.keys.map((key) => ({ ...key.principal, sha256: key.sha256 }))),
  );
  const file = join(f.directory, 'modules.json');
  const env = {
    ARKVORY_DATABASE_URL: f.config.databaseUrl,
    ARKVORY_DATA_DIR: f.directory,
    ARKVORY_KEYS_FILE: keys,
    ARKVORY_MODULES_FILE: file,
  };
  await writeFile(file, JSON.stringify({ format: 1, modules: { npm: { enabled: false } } }));
  const config = await loadConfig(env);
  assert.deepEqual([...config.modules], [['npm', { enabled: false, config: undefined }]]);
  await writeFile(file, '{"format": 1, "modules": {"teleport": {"enabled": true}}}');
  const unknown = await loadConfig(env);
  await assert.rejects(
    createServer({ ...f.config, modules: unknown.modules }),
    /Invalid ARKVORY_MODULES_FILE: unknown module teleport/,
  );
  await writeFile(file, '{"format": 1, "modules": ');
  await assert.rejects(loadConfig(env), /Invalid ARKVORY_MODULES_FILE: JSON/);
  await assert.rejects(
    loadConfig({ ...env, ARKVORY_MODULES_FILE: join(f.directory, 'absent.json') }),
    /ARKVORY_MODULES_FILE cannot be read/,
  );
  // Nothing was claimed by the refused start: the writer still serves.
  assert.equal((await f.app.inject({ url: '/health/status' })).json().status, 'ready');
});
