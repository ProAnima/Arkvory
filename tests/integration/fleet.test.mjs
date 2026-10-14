import test from 'node:test';
import assert from 'node:assert/strict';
import { readTopology } from '@proanima/arkvory-contracts';
import { setup } from './fixture.mjs';
import { separateInstance } from './mirror-fixture.mjs';

test('an installation describes itself to the fleet console; only its administrator may read it (ADR 0077)', async (t) => {
  const f = await setup(t, { siteName: 'Main site' });
  const answer = await f.app.inject({ url: '/api/v1/system/topology', headers: f.headers });
  assert.equal(answer.statusCode, 200, answer.body);
  const topology = readTopology(answer.json());
  assert.equal(topology.site.name, 'Main site');
  assert.equal(topology.site.role, 'api');
  assert.ok(topology.site.schema >= 38);
  assert.deepEqual(topology.health, { available: true, writable: true, draining: false });
  assert.equal(topology.replication, null);
  assert.deepEqual(topology.gateways, []);
  assert.deepEqual(topology.mirrors, []);
  assert.equal(topology.downloads.strategy, 'ordered');
  const reader = await f.app.inject({ url: '/api/v1/system/topology', headers: f.readerHeaders });
  assert.equal(reader.statusCode, 403);
  assert.equal(reader.json().reason, 'administrator_required');
});

test('a site pairs with a controller once by code; the fleet key reaches only its routes until revoked', async (t) => {
  const f = await setup(t, { siteName: 'Branch' });
  const call = (method, url, headers = {}, payload) =>
    f.app.inject({ method, url, headers, ...(payload ? { payload } : {}) });
  assert.equal(
    (await call('POST', '/api/v1/system/fleet/pairings', f.readerHeaders)).statusCode,
    403,
  );
  const made = await call('POST', '/api/v1/system/fleet/pairings', f.headers);
  assert.equal(made.statusCode, 201, made.body);
  const { code } = made.json();
  assert.match(code, /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  // A wrong code, then the right one in another spelling, then the same code again.
  const wrong = await call(
    'POST',
    '/api/v1/system/fleet/enrollment',
    {},
    { code: 'AAAA-AAAA-AAAA', name: 'Main' },
  );
  assert.equal(wrong.statusCode, 401);
  const enrolled = await call(
    'POST',
    '/api/v1/system/fleet/enrollment',
    {},
    {
      code: code.toLowerCase().replaceAll('-', ' '),
      name: 'Main',
    },
  );
  assert.equal(enrolled.statusCode, 201, enrolled.body);
  const { key, site } = enrolled.json();
  assert.match(key, /^afk_[A-Za-z0-9_-]{43}$/);
  assert.equal(site.name, 'Branch');
  const again = await call('POST', '/api/v1/system/fleet/enrollment', {}, { code, name: 'Thief' });
  assert.equal(again.statusCode, 401);
  const fleet = { authorization: `Bearer ${key}` };
  assert.equal((await call('GET', '/api/v1/system/topology', fleet)).statusCode, 200);
  for (const [method, url] of [
    ['GET', '/api/v1/repositories'],
    ['POST', '/api/v1/system/fleet/pairings'],
    ['GET', '/api/v1/system/fleet/controllers'],
    ['GET', '/api/v1/system/updates'],
  ]) {
    const refused = await call(method, url, fleet);
    assert.equal(refused.statusCode, 403, `${method} ${url}`);
    assert.equal(refused.json().reason, 'permission_missing');
  }
  const listed = (await call('GET', '/api/v1/system/fleet/controllers', f.headers)).json().items;
  assert.equal(listed.length, 1);
  assert.equal(listed[0].name, 'Main');
  assert.ok(listed[0].usedAt);
  assert.equal(
    (await call('DELETE', `/api/v1/system/fleet/controllers/${listed[0].id}`, f.headers))
      .statusCode,
    204,
  );
  assert.equal((await call('GET', '/api/v1/system/topology', fleet)).statusCode, 401);
  assert.equal(
    (await call('DELETE', `/api/v1/system/fleet/controllers/${listed[0].id}`, f.headers))
      .statusCode,
    404,
  );
});

test('a controller pairs with a site, keeps its state, and sees a revocation (ADR 0077)', async (t) => {
  const { mkdtemp, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { randomBytes } = await import('node:crypto');
  const secrets = await mkdtemp(join(tmpdir(), 'arkvory-fleet-'));
  const keyFile = join(secrets, 'fleet.key');
  await writeFile(keyFile, randomBytes(32).toString('hex'));
  const site = await setup(t, { siteName: 'Branch' });
  const controller = await separateInstance(t, { siteName: 'Main', fleetKeyFile: keyFile });
  const address = await site.listen();
  const on = (f, method, url, payload) =>
    f.app.inject({ method, url, headers: f.headers, ...(payload ? { payload } : {}) });
  const probe = await on(controller, 'POST', '/api/v1/fleet/sites/probe', { url: address });
  assert.equal(probe.statusCode, 200, probe.body);
  assert.deepEqual(probe.json(), { url: address, certificate: null });
  const { code } = (await on(site, 'POST', '/api/v1/system/fleet/pairings')).json();
  const added = await on(controller, 'POST', '/api/v1/fleet/sites', {
    url: address,
    fingerprint: null,
    code,
  });
  assert.equal(added.statusCode, 201, added.body);
  const managed = added.json();
  assert.equal(managed.name, 'Branch');
  assert.equal(managed.state, 'ok');
  assert.equal(managed.topology.site.name, 'Branch');
  const listed = await on(controller, 'GET', '/api/v1/fleet/sites');
  assert.equal(listed.json().items.length, 1);
  assert.doesNotMatch(listed.body + added.body, /afk_/, 'the site key never leaves the controller');
  // The site sees who manages it, and revokes it; the controller notices on its next read.
  const controllers = (await on(site, 'GET', '/api/v1/system/fleet/controllers')).json().items;
  assert.equal(controllers[0].name, 'Main');
  await on(site, 'DELETE', `/api/v1/system/fleet/controllers/${controllers[0].id}`);
  const refreshed = await on(controller, 'POST', `/api/v1/fleet/sites/${managed.id}/refresh`);
  assert.equal(refreshed.json().state, 'revoked');
  assert.equal(refreshed.json().topology.site.name, 'Branch', 'the last state stays visible');
  // A used code does not pair twice; a removed site is gone.
  const again = await on(controller, 'POST', '/api/v1/fleet/sites', {
    url: address,
    fingerprint: null,
    code,
  });
  assert.equal(again.statusCode, 409);
  assert.equal(
    (await on(controller, 'DELETE', `/api/v1/fleet/sites/${managed.id}`)).statusCode,
    204,
  );
  assert.deepEqual((await on(controller, 'GET', '/api/v1/fleet/sites')).json().items, []);
  // Readers and fleet keys never manage sites; without a key file nothing is paired.
  assert.equal(
    (await controller.app.inject({ url: '/api/v1/fleet/sites', headers: controller.readerHeaders }))
      .statusCode,
    403,
  );
  const plain = await on(site, 'POST', '/api/v1/fleet/sites', {
    url: address,
    fingerprint: null,
    code: 'X',
  });
  assert.equal(plain.statusCode, 503);
  assert.match(plain.json().message, /ARKVORY_FLEET_KEY_FILE/);
});

test('over HTTPS the controller trusts exactly the certificate the administrator confirmed (ADR 0077)', async (t) => {
  const { mkdtemp, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { randomBytes } = await import('node:crypto');
  const { selfSignedCertificate } = await import('../tls-certificate.mjs');
  const files = await mkdtemp(join(tmpdir(), 'arkvory-fleet-tls-'));
  const certificate = selfSignedCertificate();
  const certificateFile = join(files, 'site.crt');
  const keyFile = join(files, 'site.key');
  const sealFile = join(files, 'fleet.key');
  await writeFile(certificateFile, certificate.cert);
  await writeFile(keyFile, certificate.key, { mode: 0o600 });
  await writeFile(sealFile, randomBytes(32).toString('base64'));
  const site = await setup(t, {
    siteName: 'Secure',
    tls: { certificateFile, keyFile, minVersion: 'TLSv1.3', reloadSeconds: 0 },
  });
  const controller = await separateInstance(t, { siteName: 'Main', fleetKeyFile: sealFile });
  const address = `https://localhost:${new URL(await site.listen()).port}`;
  const on = (f, method, url, payload) =>
    f.app.inject({ method, url, headers: f.headers, ...(payload ? { payload } : {}) });
  const probe = (
    await on(controller, 'POST', '/api/v1/fleet/sites/probe', { url: address })
  ).json();
  assert.match(probe.certificate.fingerprint, /^[0-9a-f]{64}$/);
  const { code } = (await on(site, 'POST', '/api/v1/system/fleet/pairings')).json();
  // Another fingerprint than the one the site presents: nothing is sent, the code stays usable.
  const forged = await on(controller, 'POST', '/api/v1/fleet/sites', {
    url: address,
    fingerprint: 'f'.repeat(64),
    code,
  });
  assert.equal(forged.statusCode, 409);
  const added = await on(controller, 'POST', '/api/v1/fleet/sites', {
    url: address,
    fingerprint: probe.certificate.fingerprint,
    code,
  });
  assert.equal(added.statusCode, 201, added.body);
  assert.equal(added.json().state, 'ok');
  assert.equal(added.json().fingerprint, probe.certificate.fingerprint);
  assert.equal(added.json().topology.site.name, 'Secure');
});
