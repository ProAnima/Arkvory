import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { apiOperations, openApiDocument } from '@proanima/depot-contracts';
import { validateResponse } from '../api-schema.mjs';
import { setup, base, create } from './fixture.mjs';
import { createServer } from '../../apps/api/dist/index.js';

function url(path) {
  return path.replace(
    /\{(\w+)\}/g,
    (_all, name) =>
      ({ repository: 'releases', index: '0', packagePath: 'tool/1.0.0', assetPath: 'tool.bin' })[
        name
      ] ?? randomUUID(),
  );
}
test('every registered API method has its documented authentication boundary and native error shape', async (t) => {
  const f = await setup(t);
  const address = await f.listen();
  for (const op of apiOperations) {
    // Real HTTP matters for HEAD: Node suppresses early error bodies on the wire;
    // Fastify's injected response can still retain their serialized payload.
    const received = await fetch(address + url(op.path), { method: op.method.toUpperCase() });
    const body = await received.text();
    const response = {
      statusCode: received.status,
      headers: Object.fromEntries(received.headers),
      body,
      json: () => JSON.parse(body),
    };
    assert.equal(
      response.statusCode,
      op.access.kind !== 'public' ? 401 : op.path === '/health/live' ? 200 : 400,
      `${op.method} ${op.path}: ${response.body}`,
    );
    validateResponse(op.path, op.method, response);
  }
  const spec = await f.app.inject({ url: '/api/v1/openapi.json', headers: f.headers });
  validateResponse('/api/v1/openapi.json', 'get', spec);
  assert.deepEqual(spec.json(), openApiDocument);
});

test('startup guard rejects an undocumented registered route', async (t) => {
  const f = await setup(t);
  f.app.post('/api/v1/unchecked', async () => ({ ignored: true }));
  await assert.rejects(f.app.ready(), /API route drift.*undocumented/);
});

test('reader registers the full contract and rejects every mutation before application work', async (t) => {
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
  for (const op of apiOperations.filter((o) => !['get', 'head'].includes(o.method))) {
    const response = await reader.inject({
      method: op.method.toUpperCase(),
      url: url(op.path),
      headers: f.headers,
    });
    assert.equal(response.statusCode, 405, `${op.method} ${op.path}`);
    assert.equal(response.headers.allow, 'GET, HEAD');
    assert.equal(response.json().code, 'read_only');
    validateResponse(op.path, op.method, response);
  }
});

test('real control, upload, range and native error responses conform to the published schemas', async (t) => {
  const f = await setup(t);
  f.config.keys[0].principal.serviceAdministrator = true;
  const call = async (path, method, options = {}) => {
    const r = await f.app.inject({
      method: method.toUpperCase(),
      url: options.url ?? path,
      headers: f.headers,
      ...options,
    });
    validateResponse(path, method, r);
    return r;
  };
  const bytes = Buffer.from('contract transfer bytes');
  const created = await create(f, bytes);
  validateResponse('/api/v1/repositories/{repository}/uploads', 'post', created);
  assert.equal(created.statusCode, 201);
  const id = created.json().id;
  const root = '/api/v1/repositories/{repository}';
  await call(`${root}/uploads/{id}/content`, 'put', {
    url: `${base}/uploads/${id}/content`,
    headers: { ...f.headers, 'content-type': 'application/octet-stream' },
    payload: bytes,
  });
  const content = `${root}/artifacts/{id}/content`;
  const full = await call(content, 'get', { url: `${base}/artifacts/${id}/content` });
  assert.equal(full.statusCode, 200);
  assert.deepEqual(full.rawPayload, bytes);
  for (const [method, headers, status] of [
    ['get', { range: 'bytes=1-3' }, 206],
    ['head', { range: 'bytes=9999-' }, 200],
    ['get', { range: 'bytes=9999-' }, 416],
    ['get', { 'if-none-match': full.headers.etag }, 304],
    ['head', { 'if-none-match': full.headers.etag }, 304],
  ])
    assert.equal(
      (
        await call(content, method, {
          url: `${base}/artifacts/${id}/content`,
          headers: { ...f.headers, ...headers },
        })
      ).statusCode,
      status,
    );
  await call(`${root}/artifacts/{id}`, 'get', { url: `${base}/artifacts/${id}` });
  for (const path of [
    '/capabilities',
    '/auth/permissions',
    '/auth/me',
    '/users',
    '/access-groups',
    '/service-accounts',
  ])
    await call(`/api/v1${path}`, 'get');
  await call('/health/ready', 'get');
  for (const suffix of ['/artifacts', '/assets', '/packages', '/search', '/audit'])
    await call(`${root}${suffix}`, 'get', { url: `${base}${suffix}` });
  const account = await call('/api/v1/service-accounts', 'post', {
    payload: { name: 'contract-ci', bindings: [] },
  });
  assert.equal(account.statusCode, 201);
  const accountId = account.json().id;
  const accountPath = '/api/v1/service-accounts/{id}';
  const accountUrl = `/api/v1/service-accounts/${accountId}`;
  await call(accountPath, 'patch', {
    url: accountUrl,
    payload: { expectedRevision: 1, enabled: true },
  });
  assert.equal(
    (
      await call(accountPath, 'patch', {
        url: accountUrl,
        payload: { expectedRevision: 1, enabled: false },
      })
    ).statusCode,
    409,
  );
  const issued = await call(`${accountPath}/keys`, 'post', {
    url: `${accountUrl}/keys`,
    headers: { ...f.headers, 'idempotency-key': 'contract-issue' },
    payload: { name: 'contract-key', bindings: [] },
  });
  assert.equal(issued.statusCode, 201);
  const issuedKey = issued.json();
  const keyHeaders = { authorization: `Bearer ${issuedKey.secret}` };
  await call('/api/v1/auth/activate-key', 'post', { headers: keyHeaders });
  assert.equal(
    (await call(content, 'get', { url: `${base}/artifacts/${id}/content`, headers: keyHeaders }))
      .statusCode,
    403,
  );
  await call('/api/v1/api-keys/{id}/revoke', 'post', {
    url: `/api/v1/api-keys/${issuedKey.key.id}/revoke`,
  });
  assert.equal(
    (await call('/api/v1/auth/permissions', 'get', { headers: keyHeaders })).statusCode,
    401,
  );
  await call(`${accountPath}/audit`, 'get', { url: `${accountUrl}/audit` });
  const pending = (await create(f, bytes)).json();
  const queued = await call(`${root}/uploads/{id}/complete-async`, 'post', {
    url: `${base}/uploads/${pending.id}/complete-async`,
  });
  assert.equal(queued.statusCode, 202);
  await call('/api/v1/jobs/{id}', 'get', { url: `/api/v1/jobs/${queued.json().id}` });
  await call(`${root}/asset`, 'put', {
    url: `${base}/asset`,
    payload: { path: 'tool.bin', artifactId: id, expectedRevision: 0 },
  });
  for (const method of ['get', 'head']) {
    const legacy = await call('/endpoints/{repository}/content/{assetPath}', method, {
      url: '/endpoints/releases/content/tool.bin',
    });
    assert.equal(legacy.statusCode, 200);
  }
});
