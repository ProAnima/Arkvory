import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { ArkvoryClient } from '@proanima/arkvory-sdk';
import { createServer } from '../../apps/api/dist/index.js';
import { setup } from './fixture.mjs';
import { validateResponse } from '../api-schema.mjs';
const binding = (id, actions) => ({ resource: { kind: 'repository', id }, actions });
async function all(client, query = {}) {
  const result = [];
  let after;
  do {
    const page = await client.operations({ ...query, limit: 7, ...(after ? { after } : {}) });
    result.push(...page.items);
    after = page.next;
  } while (after);
  assert.equal(new Set(result.map((o) => o.operationId)).size, result.length);
  return result;
}
test('operation discovery is authenticated, paginated after visibility filtering and validates all query/HEAD responses', async (t) => {
  const f = await setup(t),
    address = await f.listen(),
    reader = new ArkvoryClient(address, () => f.readerHeaders.authorization.slice(7));
  assert.equal((await f.app.inject({ url: '/api/v1/operations' })).statusCode, 401);
  assert.equal((await reader.capabilities()).features.operationDiscovery, true);
  const operations = await all(reader, { repository: 'releases' });
  assert.ok(operations.some((o) => o.operationId === 'downloadArtifact'));
  assert.ok(!operations.some((o) => o.operationId === 'createUpload'));
  assert.ok(!operations.some((o) => o.surface === 'administration'));
  assert.ok(
    (await all(reader)).every(
      (o) =>
        !['repository', 'owned-resource'].includes(o.visibility) ||
        o.operationId.startsWith('listRepositories'),
    ),
  );
  const r = await f.app.inject({
    url: '/api/v1/operations?repository=releases&limit=3',
    headers: f.readerHeaders,
  });
  validateResponse('/api/v1/operations', 'get', r);
  assert.match(r.headers['cache-control'], /no-store/);
  const head = await f.app.inject({
    method: 'HEAD',
    url: '/api/v1/operations?repository=releases',
    headers: f.readerHeaders,
  });
  assert.equal(head.statusCode, 200);
  assert.equal(head.body, '');
  for (const query of [
    'surface=wrong',
    'limit=0',
    'limit=101',
    'limit=1.5',
    'limit=1&limit=2',
    'extra=1',
    'after=bad%2Fid',
    'repository=*',
  ]) {
    const invalid = await f.app.inject({
      url: `/api/v1/operations?${query}`,
      headers: f.readerHeaders,
    });
    assert.equal(invalid.statusCode, 400, query);
    validateResponse('/api/v1/operations', 'get', invalid);
  }
  await assert.rejects(reader.operations({ repository: 'private' }), { status: 404 });
  const spec = await f.app.inject({
    url: '/api/v1/openapi.json?surface=transfers',
    headers: f.readerHeaders,
  });
  assert.equal(spec.statusCode, 200);
  assert.ok(
    Object.values(spec.json().paths)
      .flatMap((item) => Object.values(item))
      .filter((o) => o.operationId)
      .every((o) => o['x-arkvory-surface'] === 'transfers'),
  );
  assert.equal(
    (await f.app.inject({ url: '/api/v1/openapi.json?surface=bad', headers: f.readerHeaders }))
      .statusCode,
    400,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(reader.operations({}, controller.signal));
});
test('managed operations intersect permissions per repository, recheck revocation, and expose only explicitly delegated administration', async (t) => {
  const f = await setup(t);
  f.config.keys[0].principal.serviceAdministrator = true;
  const address = await f.listen(),
    root = new ArkvoryClient(address, () => f.headers.authorization.slice(7));
  const bindings = [binding('alpha', ['upload.write']), binding('beta', ['upload.complete'])];
  const account = await root.createServiceAccount('operator', bindings);
  const issued = await root.issueServiceKey(account.id, 'operator', { name: 'operator', bindings });
  const client = new ArkvoryClient(address, () => issued.secret);
  await client.activateServiceKey();
  const first = await all(client, { repository: 'alpha' });
  assert.ok(first.some((o) => o.operationId === 'putUploadPart'));
  assert.deepEqual(first.find((o) => o.operationId === 'putUploadPart').conditions, [
    'resource-state',
    'upload-owner',
  ]);
  assert.ok(!first.some((o) => o.operationId === 'putUploadContent'));
  assert.ok(!first.some((o) => o.operationId === 'getRepository'));
  assert.ok(!first.some((o) => o.operationId === 'listUsers'));
  assert.ok(!first.some((o) => o.operationId === 'issueServiceKey'));
  const target = await root.createServiceAccount('target', []);
  await root.setServiceDelegation(issued.key.id, target.id, 0, ['credential.manage'], []);
  const delegated = await all(client, { surface: 'administration' });
  assert.ok(
    delegated.some(
      (o) =>
        o.operationId === 'issueServiceKey' &&
        o.conditions.includes('delegation-target-and-ceiling'),
    ),
  );
  assert.ok(!delegated.some((o) => o.operationId === 'setServicePolicy'));
  assert.ok(!delegated.some((o) => o.operationId === 'createServiceAccount'));
  assert.ok(!JSON.stringify(delegated).includes(target.id));
  await assert.rejects(client.setServicePolicy(target.id, 1, []), { status: 403 });
  await root.removeServiceDelegation(issued.key.id, target.id, 1);
  assert.ok(
    !(await all(client, { surface: 'administration' })).some(
      (o) => o.operationId === 'issueServiceKey',
    ),
  );
  await root.setServicePolicy(account.id, 1, [bindings[1]]);
  await assert.rejects(client.operations({ repository: 'alpha' }), { status: 404 });
  await root.revokeServiceKey(issued.key.id);
  await assert.rejects(client.operations(), { status: 401 });
});
test('repository SDK scopes share real upload, catalog, annotation, assets and verified download behavior', async (t) => {
  const f = await setup(t),
    address = await f.listen(),
    client = new ArkvoryClient(address, () => f.headers.authorization.slice(7));
  const repo = client.inRepository('releases');
  assert.throws(() => client.inRepository('../other'));
  assert.equal(Object.isFrozen(repo.uploads), true);
  assert.equal((await repo.describe()).id, 'releases');
  const file = new Blob(['repository-scoped SDK']),
    bytes = Buffer.from(await file.arrayBuffer());
  const created = await repo.uploads.create(randomUUID(), {
    name: 'scoped.txt',
    size: String(file.size),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    labels: [],
    metadata: {},
  });
  await repo.uploads.resume(created.id, file);
  assert.equal((await repo.artifacts.get(created.id)).status, 'available');
  assert.equal((await repo.artifacts.search({ q: 'scoped' })).items[0].id, created.id);
  const annotations = await repo.annotations.get(created.id);
  await repo.annotations.update(created.id, annotations.revision, {
    labels: ['ci'],
    collections: [],
    metadata: { source: 'sdk' },
  });
  await repo.assets.assign('latest.txt', created.id, 0);
  assert.equal((await repo.assets.get('latest.txt')).artifactId, created.id);
  assert.equal((await repo.assets.list()).items[0].path, 'latest.txt');
  const stream = await repo.artifacts.downloadVerified(created.id);
  assert.deepEqual(Buffer.from(await new Response(stream).arrayBuffer()), bytes);
  assert.equal((await repo.operations({ surface: 'transfers' })).repository, 'releases');
});
test('reader gateway lists only read operations even for a writer credential', async (t) => {
  const cleanup = [];
  t.after(async () => {
    for (const close of cleanup.reverse()) await close();
  });
  const sharedDownloads = {
    slots: 2,
    slot: 0,
    bytesPerSecond: 1048576,
    perPrincipalBytesPerSecond: 1048576,
  };
  const f = await setup({ after: (close) => cleanup.push(close) }, { sharedDownloads });
  const app = await createServer({
    ...f.config,
    role: 'reader',
    sharedDownloads: { ...sharedDownloads, slot: 1 },
  });
  cleanup.push(() => app.close());
  const response = await app.inject({
    url: '/api/v1/operations?repository=releases&limit=100',
    headers: f.headers,
  });
  assert.equal(response.statusCode, 200, response.body);
  validateResponse('/api/v1/operations', 'get', response);
  assert.equal(response.json().gatewayRole, 'reader');
  assert.ok(response.json().items.every((o) => ['get', 'head'].includes(o.method)));
  assert.ok(response.json().items.some((o) => o.operationId === 'getUpload'));
  assert.ok(!response.json().items.some((o) => o.operationId === 'createUpload'));
});

test('remote interface uses account identity and current group permissions without acquiring administration', async (t) => {
  const f = await setup(t),
    address = await f.listen(),
    root = new ArkvoryClient(address, () => f.headers.authorization.slice(7));
  const user = await root.administration.users.create('remote-ui', 'remote-ui-test-password');
  const group = await root.administration.groups.create('remote-ui-group');
  await root.administration.groups.setMember(group.id, user.id, true);
  await root.administration.groups.setGrant(group.id, 'releases', 'read');
  const session = await root.identity.login('remote-ui', 'remote-ui-test-password');
  const ui = new ArkvoryClient(address, () => session.token);
  assert.equal((await ui.identity.me()).id, `user:${user.id}`);
  const operations = await all(ui, { repository: 'releases' });
  assert.ok(operations.some((o) => o.operationId === 'changeOwnPassword'));
  assert.ok(operations.some((o) => o.operationId === 'downloadArtifact'));
  assert.ok(!operations.some((o) => o.surface === 'administration'));
  await assert.rejects(ui.administration.users.list(), { status: 403 });
  await root.administration.groups.setGrant(group.id, 'releases', null);
  await assert.rejects(ui.operations({ repository: 'releases' }), { status: 404 });
  await ui.identity.logout();
  await assert.rejects(ui.operations(), { status: 401 });
});
