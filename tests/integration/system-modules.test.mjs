import test from 'node:test';
import assert from 'node:assert/strict';
import { ArkvoryClient } from '@proanima/arkvory-sdk';
import { EXTENSION_API_VERSION } from '@proanima/arkvory-extension-api';
import { createServer } from '../../apps/api/dist/index.js';
import { setup } from './fixture.mjs';
import { validateResponse } from '../api-schema.mjs';

const URL = '/api/v1/system/modules';
const FIELDS = ['core', 'enabled', 'health', 'id', 'kind', 'roles', 'running', 'source', 'version'];

test('the global administrator reads the module plan of the installation; nobody else does', async (t) => {
  const f = await setup(t);
  const answer = await f.app.inject({ url: URL, headers: f.headers });
  assert.equal(answer.statusCode, 200, answer.body);
  const body = answer.json();
  assert.deepEqual(Object.keys(body).sort(), [
    'compatibilityFingerprint',
    'extensionApi',
    'fingerprint',
    'modules',
  ]);
  assert.equal(body.extensionApi, EXTENSION_API_VERSION);
  assert.match(body.fingerprint, /^[0-9a-f]{64}$/);
  assert.match(body.compatibilityFingerprint, /^[0-9a-f]{64}$/);
  assert.notEqual(body.compatibilityFingerprint, body.fingerprint);
  for (const module of body.modules) assert.deepEqual(Object.keys(module).sort(), FIELDS);
  assert.deepEqual(
    body.modules.map((m) => [m.id, m.kind, m.source, m.core, m.enabled, m.running]),
    [
      ['lfs', 'protocol', 'builtin', false, true, true],
      ['local-storage', 'storage-backend', 'builtin', true, true, true],
      ['npm', 'protocol', 'builtin', false, true, true],
      ['oci', 'protocol', 'builtin', false, true, true],
      ['raw', 'protocol', 'builtin', true, true, true],
      ['upack', 'protocol', 'builtin', true, true, true],
    ],
  );
  // A development build: built-in modules carry the core's version, here `dev`.
  assert.ok(body.modules.every((m) => m.version === '0.0.0-dev'));
  assert.ok(body.modules.every((m) => m.health.status === 'ok' && m.health.code === null));
  assert.deepEqual(body.modules.find((m) => m.id === 'oci').roles, ['api', 'reader', 'worker']);
  assert.equal(
    (await f.app.inject({ method: 'HEAD', url: URL, headers: f.headers })).statusCode,
    200,
  );

  const reader = await f.app.inject({ url: URL, headers: f.readerHeaders });
  assert.equal(reader.statusCode, 403);
  assert.equal(reader.json().reason, 'administrator_required');
  assert.equal((await f.app.inject({ url: URL })).statusCode, 401);
  const query = await f.app.inject({ url: `${URL}?module=npm`, headers: f.headers });
  assert.equal(query.statusCode, 400);

  // Same release, same modules: every process and every restart answers one fingerprint.
  await f.restart();
  const again = (await f.app.inject({ url: URL, headers: f.headers })).json();
  assert.equal(again.fingerprint, body.fingerprint);
  assert.equal(again.compatibilityFingerprint, body.compatibilityFingerprint);

  const origin = await f.listen();
  const client = new ArkvoryClient(origin, () => f.headers.authorization.slice(7));
  assert.deepEqual(await client.system.modules(), body);
  const denied = new ArkvoryClient(origin, () => f.readerHeaders.authorization.slice(7));
  await assert.rejects(denied.system.modules(), { status: 403, code: 'forbidden' });
});

test('a read gateway runs the same plan and answers by the published schema', async (t) => {
  const cleanup = [];
  t.after(async () => {
    for (const close of cleanup.reverse()) await close();
  });
  const policy = { slots: 2, slot: 0, bytesPerSecond: 131072, perPrincipalBytesPerSecond: 131072 };
  const f = await setup({ after: (close) => cleanup.push(close) }, { sharedDownloads: policy });
  const reader = await createServer({
    ...f.config,
    role: 'reader',
    sharedDownloads: { ...policy, slot: 1 },
  });
  cleanup.push(() => reader.close());
  const writer = await f.app.inject({ url: URL, headers: f.headers });
  const gateway = await reader.inject({ url: URL, headers: f.headers });
  for (const response of [writer, gateway]) validateResponse(URL, 'get', response);
  validateResponse(URL, 'get', await reader.inject({ url: URL, headers: f.readerHeaders }));
  assert.equal(gateway.json().fingerprint, writer.json().fingerprint);
  assert.equal(gateway.json().compatibilityFingerprint, writer.json().compatibilityFingerprint);
  // Every built-in module serves read gateways too; none of them is idle there.
  assert.ok(gateway.json().modules.every((m) => m.running && m.roles.includes('reader')));
});
