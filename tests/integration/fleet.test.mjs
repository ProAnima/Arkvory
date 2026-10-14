import test from 'node:test';
import assert from 'node:assert/strict';
import { readTopology } from '@proanima/arkvory-contracts';
import { setup, create, base } from './fixture.mjs';
import { ArkvoryClient } from '@proanima/arkvory-sdk';
import { separateInstance } from './mirror-fixture.mjs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
  // Catalog metadata is readable (F2); bytes, writes and the rest of the API are not.
  assert.equal((await call('GET', '/api/v1/repositories', fleet)).statusCode, 200);
  for (const [method, url] of [
    ['GET', '/api/v1/repositories/releases/artifacts/x/content'],
    ['GET', '/api/v1/repositories/releases/asset/content?path=a'],
    ['POST', '/api/v1/repositories/releases/uploads'],
    ['POST', '/api/v1/system/fleet/pairings'],
    ['GET', '/api/v1/system/fleet/controllers'],
    ['GET', '/api/v1/mirrors'],
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
  // Readers never manage sites.
  assert.equal(
    (
      await controller.app.inject({
        url: '/api/v1/fleet/sites',
        headers: controller.readerHeaders,
      })
    ).statusCode,
    403,
  );
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
  const pairing = (await on(site, 'POST', '/api/v1/system/fleet/pairings')).json();
  const { code } = pairing;
  // The site shows the same fingerprint beside its code: the administrator compares the two.
  assert.equal(pairing.fingerprint, probe.certificate.fingerprint);
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

test('a controller browses the catalog of a site, metadata only, never bytes (ADR 0077, F2)', async (t) => {
  const site = await setup(t, { siteName: 'Branch' });
  const controller = await separateInstance(t, { siteName: 'Main' });
  const bytes = Buffer.from('site content');
  const id = (await create(site, bytes)).json().id;
  await site.app.inject({
    method: 'PUT',
    url: `${base}/uploads/${id}/content`,
    headers: { ...site.headers, 'content-type': 'application/octet-stream' },
    payload: bytes,
  });
  await site.app.inject({
    method: 'PUT',
    url: `${base}/asset`,
    headers: site.headers,
    payload: { path: 'tools/setup.bin', artifactId: id, expectedRevision: 0 },
  });
  const address = await site.listen();
  const { code } = (
    await site.app.inject({
      method: 'POST',
      url: '/api/v1/system/fleet/pairings',
      headers: site.headers,
    })
  ).json();
  const managed = (
    await controller.app.inject({
      method: 'POST',
      url: '/api/v1/fleet/sites',
      headers: controller.headers,
      payload: { url: address, fingerprint: null, code },
    })
  ).json();
  const origin = await controller.app.listen({ host: '127.0.0.1', port: 0 });
  const client = new ArkvoryClient(origin, () => controller.headers.authorization.slice(7));
  const remote = client.fleet.site(managed.id);
  const repositories = await remote.repositories();
  assert.ok(repositories.items.some((repository) => repository.id === 'releases'));
  const found = await remote.search('releases');
  assert.ok(found.items.some((item) => item.id === id));
  assert.equal((await remote.artifact('releases', id)).id, id);
  const files = await remote.assetPage('releases');
  assert.ok(files.items.some((entry) => entry.path === 'tools/setup.bin'));
  // Only the listed metadata routes pass the controller: no bytes, no other API, no dot segments.
  const read = (path) =>
    controller.app.inject({
      url: `/api/v1/fleet/sites/${managed.id}/read?path=${encodeURIComponent(path)}`,
      headers: controller.headers,
    });
  for (const path of [
    `${base}/artifacts/${id}/content`,
    `${base}/asset/content?path=tools/setup.bin`,
    '/api/v1/system/fleet/controllers',
    `${base}/../../system/updates`,
    '/api/v1/repositories/releases/uploads',
    'api/v1/repositories',
  ])
    assert.equal((await read(path)).statusCode, 400, path);
  assert.equal((await read(`${base}/artifacts/${id}`)).statusCode, 200);
  // Only a global administrator of the controller reads sites.
  assert.equal(
    (
      await controller.app.inject({
        url: `/api/v1/fleet/sites/${managed.id}/read?path=%2Fapi%2Fv1%2Frepositories`,
        headers: controller.readerHeaders,
      })
    ).statusCode,
    403,
  );
});

test('a controller changes the download queue of a site, revision-protected and named (ADR 0077, F3)', async (t) => {
  const site = await setup(t, { siteName: 'Branch' });
  const controller = await separateInstance(t, { siteName: 'Main' });
  const address = await site.listen();
  const { code } = (
    await site.app.inject({
      method: 'POST',
      url: '/api/v1/system/fleet/pairings',
      headers: site.headers,
    })
  ).json();
  const managed = (
    await controller.app.inject({
      method: 'POST',
      url: '/api/v1/fleet/sites',
      headers: controller.headers,
      payload: { url: address, fingerprint: null, code },
    })
  ).json();
  const origin = await controller.app.listen({ host: '127.0.0.1', port: 0 });
  const client = new ArkvoryClient(origin, () => controller.headers.authorization.slice(7));
  const remote = client.fleet.site(managed.id).downloadSettings;
  const before = await remote.get();
  assert.equal(before.revision, 0);
  const saved = await remote.change({ expectedRevision: 0, overrides: { sessions: 2 } });
  assert.equal(saved.effective.sessions, 2);
  assert.equal(saved.updatedBy, `fleet:${saved.updatedBy.slice(6)}`);
  assert.ok(saved.actor, 'the administrator of the controller is named on the site');
  // The site's own view agrees, and a stale revision is the site's own conflict.
  const local = (
    await site.app.inject({ url: '/api/v1/system/downloads/settings', headers: site.headers })
  ).json();
  assert.equal(local.revision, 1);
  assert.equal(local.actor, saved.actor);
  await assert.rejects(remote.change({ expectedRevision: 0, overrides: {} }), {
    code: 'conflict',
  });
  // Only the listed changes pass, with their own method; the update mailbox is not set up here.
  const change = (path, payload = {}) =>
    controller.app.inject({
      method: 'POST',
      url: `/api/v1/fleet/sites/${managed.id}/change?path=${encodeURIComponent(path)}`,
      headers: controller.headers,
      payload,
    });
  for (const path of [
    '/api/v1/system/fleet/pairings',
    '/api/v1/repositories/releases/uploads',
    '/api/v1/system/downloads/settings?x=1',
    '/api/v1/system/updates',
  ])
    assert.equal((await change(path)).statusCode, 400, path);
  const update = await change('/api/v1/system/updates/requests', {
    id: '00000000-0000-4000-8000-000000000001',
    expectedRevision: 0,
    kind: 'check',
  });
  assert.equal(update.statusCode, 503, update.body);
  assert.equal(
    (
      await controller.app.inject({
        method: 'POST',
        url: `/api/v1/fleet/sites/${managed.id}/change?path=${encodeURIComponent('/api/v1/system/downloads/settings')}`,
        headers: controller.readerHeaders,
        payload: { expectedRevision: 1, overrides: {} },
      })
    ).statusCode,
    403,
  );
});

test('a controller queues a mirror change for the agent of a site; the key goes in its own file', async (t) => {
  // The updater mailbox of the site with an agent that reported in a moment ago.
  const mailbox = await mkdtemp(join(tmpdir(), 'arkvory-fleet-mailbox-'));
  t.after(() => rm(mailbox, { recursive: true, force: true }));
  await mkdir(join(mailbox, 'status'));
  await mkdir(join(mailbox, 'inbox'));
  await writeFile(
    join(mailbox, 'status/changes.json'),
    JSON.stringify({ heartbeatAt: new Date().toISOString(), recent: [] }),
  );
  const site = await setup(t, { siteName: 'Branch', updateControlDirectory: mailbox });
  const controller = await separateInstance(t, { siteName: 'Main' });
  const address = await site.listen();
  const { code } = (
    await site.app.inject({
      method: 'POST',
      url: '/api/v1/system/fleet/pairings',
      headers: site.headers,
    })
  ).json();
  const managed = (
    await controller.app.inject({
      method: 'POST',
      url: '/api/v1/fleet/sites',
      headers: controller.headers,
      payload: { url: address, fingerprint: null, code },
    })
  ).json();
  const origin = await controller.app.listen({ host: '127.0.0.1', port: 0 });
  const client = new ArkvoryClient(origin, () => controller.headers.authorization.slice(7));
  const changes = client.fleet.site(managed.id).changes;
  assert.equal((await changes.status()).agent, true);
  const key = 'arkvory_' + 'z'.repeat(40);
  const id = '00000000-0000-4000-8000-0000000000aa';
  await changes.request({
    id,
    key,
    change: {
      kind: 'mirror-attach',
      repository: 'imports',
      upstream: 'https://source.example',
      sourceRepository: 'releases',
      stages: ['tested'],
      certificate: null,
    },
  });
  const queued = JSON.parse(await readFile(join(mailbox, 'inbox/change.json'), 'utf8'));
  assert.equal(queued.id, id);
  assert.match(queued.actor, /\(fleet:[0-9a-f-]+\)$/);
  assert.equal(await readFile(join(mailbox, 'inbox/change.key'), 'utf8'), key);
  assert.doesNotMatch(JSON.stringify(queued), /zzzz/);
  const seen = await changes.status();
  assert.equal(seen.pending?.id, id);
  assert.doesNotMatch(JSON.stringify(seen), /zzzz/);
  // A switchover is never one click: the node is typed twice, checked by both sides.
  const typo = await controller.app.inject({
    method: 'POST',
    url: `/api/v1/fleet/sites/${managed.id}/change?path=${encodeURIComponent('/api/v1/system/changes')}`,
    headers: controller.headers,
    payload: {
      id: '00000000-0000-4000-8000-0000000000ab',
      change: { kind: 'cluster-switchover', node: 'node-b', confirm: 'node-c' },
    },
  });
  assert.equal(typo.statusCode, 400);
  assert.deepEqual((await readdir(join(mailbox, 'inbox'))).sort(), ['change.json', 'change.key']);
});
