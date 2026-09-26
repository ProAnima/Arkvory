import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ArkvoryClient } from '@proanima/arkvory-sdk';
import { createServer } from '../../apps/api/dist/index.js';
import { validateResponse } from '../api-schema.mjs';
import { setup, base, create } from './fixture.mjs';
const binding = (id, actions) => ({ resource: { kind: 'repository', id }, actions });
async function managed(f, bindings) {
  f.config.keys[0].principal.serviceAdministrator = true;
  const address = await f.listen(),
    root = new ArkvoryClient(address, () => f.headers.authorization.slice(7));
  const account = await root.createServiceAccount('discovery', bindings);
  const key = await root.issueServiceKey(account.id, 'discovery', {
    name: 'discovery-key',
    bindings,
  });
  const client = new ArkvoryClient(address, () => key.secret);
  await client.activateServiceKey();
  return { address, root, account, key, client };
}
test('repository discovery exposes own logical scopes with schemas, paging and unchanged legacy permissions', async (t) => {
  const f = await setup(t);
  f.config.keys[0].principal.repositories = ['zulu', 'alpha', 'alpha', 'releases'];
  const address = await f.listen(),
    client = new ArkvoryClient(address, () => f.headers.authorization.slice(7));
  assert.equal((await client.capabilities()).features.repositoryDiscovery, true);
  const first = await client.repositories({ limit: 2 });
  assert.deepEqual(
    first.items.map((c) => c.id),
    ['alpha', 'releases'],
  );
  assert.equal(first.next, 'releases');
  assert.deepEqual(
    (await client.repositories({ after: first.next })).items.map((c) => c.id),
    ['zulu'],
  );
  const card = await client.repository('alpha');
  assert.deepEqual(card.formats, ['upack', 'assets']);
  assert.equal(card.permissions.length, 19);
  const old = await client.permissions();
  assert.ok(old.bindings.every((b) => !b.actions.includes('repository.read')));
  for (const [url, path] of [
    ['/api/v1/repositories', '/api/v1/repositories'],
    ['/api/v1/repositories/alpha', '/api/v1/repositories/{repository}'],
  ]) {
    const response = await f.app.inject({ url, headers: f.headers });
    assert.equal(response.statusCode, 200);
    validateResponse(path, 'get', response);
    assert.match(response.headers['cache-control'], /no-store/);
    const head = await fetch(address + url, { method: 'HEAD', headers: f.headers });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
  }
  const missing = await f.app.inject({ url: '/api/v1/repositories/hidden', headers: f.headers });
  assert.equal(missing.statusCode, 404);
  validateResponse('/api/v1/repositories/{repository}', 'get', missing);
  assert.equal(
    (await f.catalog.pool.query('SELECT count(*)::integer AS count FROM arkvory_uploads')).rows[0]
      .count,
    0,
  );
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(client.repositories({}, aborted.signal));
});

test('managed discovery is opt-in, filters before LIMIT and never grants bytes, metadata or management', async (t) => {
  const f = await setup(t);
  const m = await managed(f, [
    binding('aaa-hidden', ['content.read']),
    binding('alpha', ['repository.read']),
    binding('alpha', ['asset.read']),
    binding('zulu', ['repository.read']),
  ]);
  assert.deepEqual(
    (await m.client.repositories({ limit: 1 })).items.map((c) => c.id),
    ['alpha'],
  );
  assert.deepEqual((await m.client.repository('alpha')).permissions, [
    'asset.read',
    'repository.read',
  ]);
  await assert.rejects(m.client.repository('aaa-hidden'), { status: 404 });
  const headers = { authorization: `Bearer ${m.key.secret}` };
  for (const suffix of [`artifacts/${randomUUID()}/content`, 'packages', 'assets/page']) {
    const r = await f.app.inject({ url: `/api/v1/repositories/zulu/${suffix}`, headers });
    assert.equal(r.statusCode, 403, r.body);
  }
  assert.deepEqual(await m.client.repositories({ after: 'zzz' }), { items: [], next: null });
  const upload = await f.app.inject({
    method: 'POST',
    url: '/api/v1/repositories/zulu/uploads',
    headers: { ...headers, 'idempotency-key': 'forbidden' },
    payload: { name: 'empty', size: '0', sha256: '0'.repeat(64), labels: [], metadata: {} },
  });
  assert.equal(upload.statusCode, 403);
  await assert.rejects(m.client.createServiceAccount('forbidden', []), { status: 403 });
  // A previously issued narrow data key keeps its data behavior without discovery.
  const content = await m.root.issueServiceKey(m.account.id, 'content', {
    name: 'content-only',
    bindings: [binding('aaa-hidden', ['content.read'])],
  });
  const narrow = new ArkvoryClient(m.address, () => content.secret);
  await narrow.activateServiceKey();
  assert.deepEqual(await narrow.repositories(), { items: [], next: null });
  const absent = await f.app.inject({
    url: `/api/v1/repositories/aaa-hidden/artifacts/${randomUUID()}/content`,
    headers: { authorization: `Bearer ${content.secret}` },
  });
  assert.equal(absent.statusCode, 404);
});

test('repository pages recheck policy, expiry, disable and revoke and preserve active cursor semantics', async (t) => {
  const f = await setup(t),
    bindings = [binding('alpha', ['repository.read']), binding('beta', ['repository.read'])];
  const m = await managed(f, bindings),
    first = await m.client.repositories({ limit: 1 });
  await m.root.setServicePolicy(m.account.id, 1, [bindings[0]]);
  assert.deepEqual(await m.client.repositories({ after: first.next }), { items: [], next: null });
  await assert.rejects(m.client.repository('beta'), { status: 404 });
  await m.root.setServicePolicy(m.account.id, 2, bindings);
  assert.deepEqual(
    (await m.client.repositories({ after: first.next })).items.map((c) => c.id),
    ['beta'],
  );
  await m.root.updateServiceAccount(m.account.id, 3, false);
  await assert.rejects(m.client.repositories(), { status: 401 });
  await m.root.updateServiceAccount(m.account.id, 4, true);
  const rotated = await m.root.rotateServiceKey(m.key.key.id, 'rotation', {
    name: 'new-discovery',
    bindings,
  });
  const newClient = new ArkvoryClient(m.address, () => rotated.secret);
  await newClient.activateServiceKey();
  assert.deepEqual(
    (await newClient.repositories({ after: first.next })).items.map((c) => c.id),
    ['beta'],
  );
  await m.root.revokeServiceKey(m.key.key.id);
  await assert.rejects(m.client.repositories(), { status: 401 });
  await f.catalog.pool.query(
    "UPDATE arkvory_api_keys SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
    [rotated.key.id],
  );
  await assert.rejects(newClient.repository('alpha'), { status: 401 });
});

test('repository request validation rejects ambiguous filters while content presence never exposes a hidden scope', async (t) => {
  const f = await setup(t);
  for (const query of [
    'limit=0',
    'limit=101',
    'limit=-1',
    'limit=1.1',
    'limit=01',
    'limit=1&limit=2',
    'after=',
    'after=Bad',
    'after=foo/bar',
    'unknown=x',
  ]) {
    const response = await f.app.inject({
      url: '/api/v1/repositories?' + query,
      headers: f.headers,
    });
    assert.equal(response.statusCode, 400, query);
    validateResponse('/api/v1/repositories', 'get', response);
  }
  assert.equal(
    (await f.app.inject({ url: '/api/v1/repositories/releases?unknown=x', headers: f.headers }))
      .statusCode,
    400,
  );
  assert.equal(
    (await f.app.inject({ url: '/api/v1/repositories/Bad', headers: f.headers })).statusCode,
    400,
  );
  await create(f, Buffer.from('private'));
  f.config.keys[1].principal.repositories = [];
  const before = await f.app.inject({
    url: '/api/v1/repositories/releases',
    headers: f.readerHeaders,
  });
  const missing = await f.app.inject({
    url: '/api/v1/repositories/absent',
    headers: f.readerHeaders,
  });
  assert.equal(before.statusCode, 404);
  assert.equal(missing.statusCode, 404);
  assert.equal(before.json().message, missing.json().message);
  f.config.keys[0].principal.repositories = []; // bootstrap/administrator without data scope is not a global inventory viewer.
  assert.deepEqual(
    (await f.app.inject({ url: '/api/v1/repositories', headers: f.headers })).json(),
    { items: [], next: null },
  );
});

test('user group grants and the read gateway preserve group write semantics and separate file-key read/write', async (t) => {
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
  const address = await f.listen(),
    root = new ArkvoryClient(address, () => f.headers.authorization.slice(7));
  const user = await root.createUser('repository-user', 'long-private-test-password');
  const group = await root.createAccessGroup('repository-group');
  await root.setGroupMember(group.id, user.id, true);
  await root.setGroupGrant(group.id, 'releases', 'write');
  const logged = await root.login('repository-user', 'long-private-test-password');
  const headers = { authorization: `Bearer ${logged.token}` };
  const response = await reader.inject({ url: '/api/v1/repositories/releases', headers });
  assert.equal(response.statusCode, 200, response.body);
  const permissions = response.json().permissions;
  assert.ok(permissions.includes('repository.read'));
  assert.ok(permissions.includes('upload.create'));
  // Existing group access=write resolves both coarse read and write; preserve it.
  assert.equal(permissions.includes('content.read'), true);
  await root.setGroupGrant(group.id, 'releases', 'read');
  const readOnly = await reader.inject({ url: '/api/v1/repositories/releases', headers });
  assert.equal(readOnly.json().permissions.includes('upload.create'), false);
  f.config.keys[1].principal.permissions = ['write'];
  const fileKey = await reader.inject({
    url: '/api/v1/repositories/releases',
    headers: f.readerHeaders,
  });
  assert.equal(fileKey.json().permissions.includes('upload.create'), true);
  assert.equal(fileKey.json().permissions.includes('content.read'), false);
  assert.equal(
    (
      await reader.inject({
        url: `${base}/artifacts/${randomUUID()}/content`,
        headers: f.readerHeaders,
      })
    ).statusCode,
    403,
  );
  await root.setGroupGrant(group.id, 'releases', null);
  assert.deepEqual((await reader.inject({ url: '/api/v1/repositories', headers })).json(), {
    items: [],
    next: null,
  });
  assert.equal(
    (await reader.inject({ url: '/api/v1/repositories/releases', headers })).statusCode,
    404,
  );
});
