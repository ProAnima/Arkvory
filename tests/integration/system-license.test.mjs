import test from 'node:test';
import assert from 'node:assert/strict';
import { ArkvoryClient } from '@proanima/arkvory-sdk';
import { PostgresLicenceStore, parseModuleSelections } from '@proanima/arkvory-infrastructure';
import { setup } from './fixture.mjs';
import { validateResponse } from '../api-schema.mjs';
import { moduleInstallation, modulePackage } from '../module-fixtures.mjs';
import { DAY, licenceAuthority } from '../licence-fixtures.mjs';

const URL = '/api/v1/system/license';

async function fixture(t, overrides) {
  const cleanup = [];
  t.after(async () => {
    for (const close of cleanup.reverse()) await close();
  });
  const f = await setup({ after: (close) => cleanup.push(close) }, overrides);
  return Object.assign(f, { cleanup });
}

test('the global administrator reads the licences; the free core has none and needs none', async (t) => {
  const f = await fixture(t);
  const answer = await f.app.inject({ url: URL, headers: f.headers });
  assert.equal(answer.statusCode, 200, answer.body);
  validateResponse(URL, 'get', answer);
  const body = answer.json();
  assert.deepEqual(Object.keys(body).sort(), [
    'clockRollback',
    'effectiveTime',
    'installation',
    'licenses',
    'pendingRequests',
  ]);
  assert.deepEqual(
    { ...body, effectiveTime: undefined },
    {
      installation: null,
      effectiveTime: undefined,
      clockRollback: false,
      pendingRequests: 0,
      licenses: [],
    },
  );
  assert.match(body.effectiveTime, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  const reader = await f.app.inject({ url: URL, headers: f.readerHeaders });
  assert.equal(reader.statusCode, 403);
  assert.equal(reader.json().reason, 'administrator_required');
  assert.equal((await f.app.inject({ url: URL })).statusCode, 401);
  assert.equal((await f.app.inject({ url: `${URL}?x=1`, headers: f.headers })).statusCode, 400);
  assert.equal(
    (await f.app.inject({ method: 'HEAD', url: URL, headers: f.headers })).statusCode,
    200,
  );
  const origin = await f.listen();
  const client = new ArkvoryClient(origin, () => f.headers.authorization.slice(7));
  const sdk = await client.system.license();
  assert.deepEqual({ ...sdk, effectiveTime: undefined }, { ...body, effectiveTime: undefined });
});

test('a stored token that does not lead to the built-in root is invalid, never trusted', async (t) => {
  const f = await fixture(t);
  const authority = licenceAuthority(Date.now() - 100 * DAY);
  const token = authority.token({ issuedAtMs: Date.now() - DAY });
  const payload = JSON.parse(Buffer.from(JSON.parse(token).payload, 'base64url'));
  const store = new PostgresLicenceStore(f.catalog.pool);
  await store.saveToken({
    activationId: payload.activationId,
    licenceId: payload.licenceId,
    installation: payload.installation,
    activation: 'online',
    token,
    seq: 1,
    issuedAt: Date.now() - DAY,
    refreshAfter: Date.now(),
    notAfter: Date.now() + 29 * DAY,
    nextAttemptAt: null,
  });
  const answer = await f.app.inject({ url: URL, headers: f.headers });
  validateResponse(URL, 'get', answer);
  const [licence] = answer.json().licenses;
  assert.equal(licence.state, 'invalid');
  assert.equal(licence.reason, 'document_signature');
  assert.deepEqual(licence.features, [], 'nothing of an unverified document is shown as granted');
  assert.equal(answer.body.includes(JSON.parse(token).signature.split('\n')[1]), false);
  assert.equal(answer.body.includes(JSON.parse(token).payload), false);
});

test('a signed module that uses the license service gets it; others get nothing', async (t) => {
  const host = await moduleInstallation(t);
  await host.install(
    modulePackage(
      host.keys.module,
      { id: 'paid', kind: 'event-sink', uses: ['license'], licenseFeature: 'dedup' },
      { recordServices: true },
    ),
  );
  await host.install(
    modulePackage(host.keys.module, { id: 'plain', kind: 'event-sink' }, { recordServices: true }),
  );
  const f = await fixture(t, {
    installedModules: host.source(),
    modules: parseModuleSelections({
      format: 1,
      modules: { paid: { enabled: true }, plain: { enabled: true } },
    }),
  });
  const modules = (
    await f.app.inject({ url: '/api/v1/system/modules', headers: f.headers })
  ).json();
  assert.equal(modules.modules.find((m) => m.id === 'paid').health.status, 'ok');
  const services = globalThis.arkvoryServices;
  assert.deepEqual(Object.keys(services.plain), []);
  assert.deepEqual(Object.keys(services.paid), ['license']);
  const view = await services.paid.license.view('dedup');
  assert.equal(view.state, 'none');
  assert.equal(view.licenseId, null);
  assert.deepEqual(await services.paid.license.evidence(), []);
});
