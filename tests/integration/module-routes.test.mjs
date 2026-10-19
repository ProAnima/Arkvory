import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { ArkvoryClient } from '@proanima/arkvory-sdk';
import { parseModuleSelections } from '@proanima/arkvory-infrastructure';
import { createServer } from '../../apps/api/dist/index.js';
import { base, create, setup } from './fixture.mjs';
import { validateResponse } from '../api-schema.mjs';
import { moduleInstallation, modulePackage } from '../module-fixtures.mjs';
import { echoRoutesPackage } from '../module-route-fixtures.mjs';

const ext = '/api/ext/echo/v1';
const enable = (...ids) =>
  parseModuleSelections({
    format: 1,
    modules: Object.fromEntries(ids.map((id) => [id, { enabled: true }])),
  });
const policy = { slots: 2, slot: 0, bytesPerSecond: 1 << 24, perPrincipalBytesPerSecond: 1 << 24 };

async function fixture(t, overrides) {
  const cleanup = [];
  t.after(async () => {
    for (const close of cleanup.reverse()) await close();
  });
  const f = await setup({ after: (close) => cleanup.push(close) }, overrides);
  return Object.assign(f, { cleanup });
}

async function publish(f, bytes) {
  const id = (await create(f, bytes)).json().id;
  const put = await f.app.inject({
    method: 'PUT',
    url: `${base}/uploads/${id}/content`,
    headers: { ...f.headers, 'content-type': 'application/octet-stream' },
    payload: bytes,
  });
  assert.equal(put.statusCode, 200, put.body);
  return id;
}

async function echoServer(t) {
  const host = await moduleInstallation(t);
  await host.install(echoRoutesPackage(host.keys.module));
  const f = await fixture(t, {
    installedModules: host.source(),
    modules: enable('echo'),
    sharedDownloads: policy,
  });
  return { host, f };
}

test('a signed module serves JSON, content and stream routes through the core', async (t) => {
  const { f } = await echoServer(t);
  const get = (url, headers = {}, method = 'GET') =>
    f.app.inject({ method, url, headers: { ...f.headers, ...headers } });
  const info = await get(`${ext}/info/hello?x=1`);
  assert.equal(info.statusCode, 200, info.body);
  assert.deepEqual(info.json(), {
    module: 'echo',
    word: 'hello',
    query: { x: '1' },
    method: 'GET',
    mode: 'full',
  });
  assert.equal(info.headers['cache-control'], 'private, no-store');
  assert.equal(info.headers['content-security-policy'], "default-src 'none'; sandbox");
  assert.equal(info.headers['x-content-type-options'], 'nosniff');
  // Authentication is the core's: no credential, no module code.
  const anonymous = await f.app.inject({ url: `${ext}/info/hello` });
  assert.equal(anonymous.statusCode, 401);
  assert.equal(anonymous.json().code, 'unauthorized');

  // content: the core's sender, with the same ETag, Range, If-Range and 304 as /api/v1.
  const bytes = randomBytes(70_000);
  const id = await publish(f, bytes);
  const content = `${ext}/repositories/releases/artifacts/${id}/content`;
  const core = await get(`${base}/artifacts/${id}/content`);
  const whole = await get(content);
  assert.equal(whole.statusCode, 200);
  assert.deepEqual(whole.rawPayload, bytes);
  for (const name of ['etag', 'content-length', 'accept-ranges', 'content-disposition'])
    assert.equal(whole.headers[name], core.headers[name], name);
  assert.equal(whole.headers.etag, `"sha256:${createHash('sha256').update(bytes).digest('hex')}"`);
  assert.equal(whole.headers['cache-control'], 'private, no-store');
  const part = await get(content, { range: 'bytes=10-19' });
  assert.equal(part.statusCode, 206);
  assert.equal(part.headers['content-range'], `bytes 10-19/${bytes.length}`);
  assert.deepEqual(part.rawPayload, bytes.subarray(10, 20));
  assert.equal((await get(content, { 'if-none-match': whole.headers.etag })).statusCode, 304);
  const stale = await get(content, { range: 'bytes=0-9', 'if-range': '"sha256:other"' });
  assert.equal(stale.statusCode, 200);
  assert.equal(stale.rawPayload.length, bytes.length);
  const head = await get(content, {}, 'HEAD');
  assert.equal(head.statusCode, 200);
  assert.equal(head.headers['content-length'], String(bytes.length));
  assert.equal(head.body, '');
  const unsatisfiable = await get(content, { range: 'bytes=999999-' });
  assert.equal(unsatisfiable.statusCode, 416);
  // A published blob may be cached privately for a year when the module asks; never a refusal.
  const cached = await get(`${content}?cache=immutable`);
  assert.equal(cached.headers['cache-control'], 'private, max-age=31536000, immutable');
  const missing = await get(
    `${ext}/repositories/releases/artifacts/${crypto.randomUUID()}/content`,
  );
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.headers['cache-control'], 'private, no-store');

  // stream: built by the module, without Range, with the module's strong ETag.
  const stream = await get(`${ext}/stream?size=70000`, { range: 'bytes=0-9' });
  assert.equal(stream.statusCode, 200);
  assert.equal(stream.rawPayload.length, 70_000);
  assert.equal(stream.headers['accept-ranges'], 'none');
  assert.equal(stream.headers['content-length'], '70000');
  assert.equal(stream.headers.etag, '"echo-70000"');
  assert.equal(
    (await get(`${ext}/stream?size=70000`, { 'if-none-match': '"echo-70000"' })).statusCode,
    304,
  );
  assert.equal((await get(`${ext}/stream?size=5`, {}, 'HEAD')).headers['content-length'], '5');
});

test('the core checks access and actions before module code; bodies keep their limits', async (t) => {
  const { f } = await echoServer(t);
  const id = await publish(f, randomBytes(1024));
  // Read access to the repository is enough for content; another repository is not.
  const content = (repository) =>
    f.app.inject({
      url: `${ext}/repositories/${repository}/artifacts/${id}/content`,
      headers: f.readerHeaders,
    });
  assert.equal((await content('releases')).statusCode, 200);
  const foreign = await content('elsewhere');
  assert.equal(foreign.statusCode, 403);
  assert.equal(foreign.json().reason, 'permission_missing');

  const upload = (headers, payload) =>
    f.app.inject({
      method: 'POST',
      url: `${ext}/repositories/releases/echo`,
      headers: { 'content-type': 'application/octet-stream', ...headers },
      payload,
    });
  const data = randomBytes(3000);
  const stored = await upload(f.headers, data);
  assert.equal(stored.statusCode, 201, stored.body);
  assert.deepEqual(stored.json(), {
    length: 3000,
    declared: 3000,
    sha256: createHash('sha256').update(data).digest('hex'),
  });
  // A writing route needs its writing action: a read grant is refused before any byte is read.
  const denied = await upload(f.readerHeaders, data);
  assert.equal(denied.statusCode, 403);
  const large = await upload(f.headers, Buffer.alloc(1024 * 1024 + 1));
  assert.equal(large.statusCode, 413);
  assert.equal(large.json().reason, 'body_too_large');

  const note = (headers, payload, type = 'application/json') =>
    f.app.inject({
      method: 'POST',
      url: `${ext}/admin/notes`,
      headers: { ...headers, 'content-type': type },
      payload,
    });
  const accepted = await note(f.headers, JSON.stringify({ text: 'hi' }));
  assert.equal(accepted.statusCode, 202);
  assert.deepEqual(accepted.json(), { received: { text: 'hi' } });
  const refused = await note(f.readerHeaders, JSON.stringify({ text: 'hi' }));
  assert.equal(refused.statusCode, 403);
  assert.equal(refused.json().reason, 'administrator_required');
  assert.equal((await note(f.headers, 'plain', 'text/plain')).statusCode, 415);
  assert.equal((await note(f.headers, JSON.stringify({ text: 'x'.repeat(2000) }))).statusCode, 413);

  // Failures of module code follow the error contract and never echo the module's error.
  const answer = (path) => f.app.inject({ url: `${ext}/${path}`, headers: f.headers });
  const failed = await answer('fail');
  assert.equal(failed.statusCode, 500);
  assert.equal(failed.json().code, 'internal');
  assert.doesNotMatch(failed.body, /boom/);
  const slow = await answer('slow');
  assert.equal(slow.statusCode, 503);
  assert.equal(slow.json().code, 'unavailable');
  assert.equal((await answer('refuse')).json().code, 'conflict');
  const html = await answer('bad');
  assert.equal(html.statusCode, 500);
  assert.notEqual(html.headers['content-type'], 'text/html');
});

test('module routes are documented apart from /api/v1, offered as transfers and served by read gateways', async (t) => {
  const { f } = await echoServer(t);
  const plan = (await f.app.inject({ url: '/api/v1/system/modules', headers: f.headers })).json();
  const document = async (headers, app = f.app) =>
    (await app.inject({ url: '/api/ext/openapi.json', headers })).json();
  const full = await document(f.headers);
  assert.equal(full.openapi, '3.1.0');
  assert.equal(full.info.version, plan.fingerprint);
  assert.equal(full.paths[`${ext}/admin/notes`].post['x-arkvory-module'], 'echo');
  assert.equal(
    full.paths[`${ext}/repositories/{repository}/echo`].post['x-arkvory-action'],
    'upload.create',
  );
  assert.ok(full.components.schemas.ext_echo_Answer);
  assert.ok(full.components.schemas.NativeError);
  // Administrator operations only for the administrator.
  assert.equal((await document(f.readerHeaders)).paths[`${ext}/admin/notes`], undefined);
  const core = (await f.app.inject({ url: '/api/v1/openapi.json', headers: f.headers })).json();
  assert.equal(Object.keys(core.paths).filter((path) => path.startsWith('/api/ext/')).length, 0);

  const fragment = await f.app.inject({
    url: '/api/v1/system/modules/echo/openapi',
    headers: f.headers,
  });
  assert.equal(fragment.statusCode, 200);
  validateResponse('/api/v1/system/modules/{id}/openapi', 'get', fragment);
  assert.deepEqual(Object.keys(fragment.json().paths).sort(), Object.keys(full.paths).sort());
  const none = await f.app.inject({
    url: '/api/v1/system/modules/raw/openapi',
    headers: f.headers,
  });
  assert.equal(none.statusCode, 404);
  const forbidden = await f.app.inject({
    url: '/api/v1/system/modules/echo/openapi',
    headers: f.readerHeaders,
  });
  assert.equal(forbidden.json().reason, 'administrator_required');

  const offer = { name: 'echo', versions: ['1.0.0', '1.1.0'], module: 'echo', prefix: `${ext}/` };
  const capabilities = await f.app.inject({ url: '/api/v1/capabilities', headers: f.headers });
  validateResponse('/api/v1/capabilities', 'get', capabilities);
  assert.deepEqual(capabilities.json().transfer, [offer]);
  const client = new ArkvoryClient(await f.listen(), () => f.headers.authorization.slice(7));
  assert.deepEqual((await client.capabilities()).transfer, [offer]);
  assert.deepEqual(await client.system.moduleOpenApi('echo'), fragment.json());

  const reader = await createServer({
    ...f.config,
    role: 'reader',
    sharedDownloads: { ...policy, slot: 1 },
  });
  f.cleanup.push(() => reader.close());
  const read = await reader.inject({ url: `${ext}/info/word`, headers: f.headers });
  assert.equal(read.statusCode, 200, read.body);
  assert.equal(read.json().mode, 'read-only');
  const write = await reader.inject({
    method: 'POST',
    url: `${ext}/repositories/releases/echo`,
    headers: { ...f.headers, 'content-type': 'application/octet-stream' },
    payload: Buffer.from('x'),
  });
  assert.equal(write.statusCode, 405);
  assert.equal(write.json().code, 'read_only');
  const gateway = await document(f.headers, reader);
  assert.ok(gateway.paths[`${ext}/info/{word}`]);
  assert.equal(gateway.paths[`${ext}/repositories/{repository}/echo`], undefined);
  const offered = (await reader.inject({ url: '/api/v1/capabilities', headers: f.headers })).json();
  assert.deepEqual(offered.transfer, [offer]);
});

test('a module whose routes break the contract fails alone and serves nothing', async (t) => {
  const host = await moduleInstallation(t);
  const { module } = host.keys;
  await host.install(echoRoutesPackage(module, { id: 'undocumented' }, { fragment: 'missing' }));
  await host.install(echoRoutesPackage(module, { id: 'phantom' }, { fragment: 'extra' }));
  await host.install(echoRoutesPackage(module, { id: 'borrower' }, { fragment: 'foreign' }));
  await host.install(echoRoutesPackage(module, { id: 'silent' }, { fragment: 'none' }));
  await host.install(echoRoutesPackage(module, { id: 'escaper' }, { outside: true }));
  await host.install(echoRoutesPackage(module, { id: 'misfit', kind: 'protocol' }));
  await host.install(
    modulePackage(module, { id: 'routeless', routePrefixes: ['/api/ext/routeless/v1/'] }),
  );
  await host.install(echoRoutesPackage(module));
  const ids = ['undocumented', 'phantom', 'borrower', 'silent', 'escaper', 'misfit', 'routeless'];
  const f = await fixture(t, {
    installedModules: host.source(),
    modules: enable('echo', ...ids),
    sharedDownloads: policy,
  });
  const listed = (await f.app.inject({ url: '/api/v1/system/modules', headers: f.headers })).json();
  const health = Object.fromEntries(listed.modules.map((m) => [m.id, [m.running, m.health.code]]));
  assert.deepEqual(Object.fromEntries(ids.map((id) => [id, health[id]])), {
    undocumented: [false, 'openapi_route_mismatch'],
    phantom: [false, 'openapi_route_mismatch'],
    borrower: [false, 'openapi_invalid'],
    silent: [false, 'openapi_invalid'],
    escaper: [false, 'routes_invalid'],
    misfit: [false, 'transfer_invalid'],
    routeless: [false, 'routes_unsupported'],
  });
  assert.deepEqual(health.echo, [true, null]);
  // The process stays ready and the routes of the failed modules are unknown paths.
  assert.equal((await f.app.inject({ url: '/health/ready', headers: f.headers })).statusCode, 200);
  const gone = await f.app.inject({ url: '/api/ext/phantom/v1/info/x', headers: f.headers });
  assert.equal(gone.statusCode, 404);
  assert.equal(gone.json().reason, 'route_not_found');
  assert.equal((await f.app.inject({ url: `${ext}/info/x`, headers: f.headers })).statusCode, 200);
  const offered = (await f.app.inject({ url: '/api/v1/capabilities', headers: f.headers })).json();
  assert.deepEqual(
    offered.transfer.map((o) => o.module),
    ['echo'],
  );
});

test('signed routes read accepted upload ranges with ownership and request scope; offers withdraw live', async (t) => {
  const host = await moduleInstallation(t);
  await host.install(
    echoRoutesPackage(
      host.keys.module,
      { uses: ['routes', 'catalog-read', 'upload-read'] },
      { scope: true },
    ),
  );
  const f = await fixture(t, { installedModules: host.source(), modules: enable('echo') });
  const bytes = Buffer.from('accepted bytes before completion');
  const created = await create(f, bytes);
  assert.equal(created.statusCode, 201, created.body);
  const id = created.json().id;
  const accepted = await f.app.inject({
    method: 'PUT',
    url: `${base}/uploads/${id}/parts/0`,
    headers: {
      ...f.headers,
      'content-type': 'application/octet-stream',
      'x-content-sha256': createHash('sha256').update(bytes).digest('hex'),
    },
    payload: bytes,
  });
  assert.equal(accepted.statusCode, 204, accepted.body);
  const url = `${ext}/uploads/releases/${id}`;
  const get = (suffix = '', headers = f.headers, method = 'GET') =>
    f.app.inject({ method, url: url + suffix, headers });
  const result = await get('?start=3&end=13');
  assert.equal(result.statusCode, 200, result.body);
  assert.deepEqual(result.rawPayload, bytes.subarray(3, 14));
  assert.equal((await get('?retained=1')).json().upload, null);
  assert.equal((await get('?view=1')).json().state, 'pending');
  assert.equal((await get('?view=1', f.readerHeaders)).statusCode, 404);
  assert.equal((await get('?start=0&end=2&eager=1', f.headers, 'HEAD')).statusCode, 200);
  assert.equal((await get('?retained=1')).json().upload, null);
  assert.equal(
    (await get('?start=0&end=2&eager=1', { ...f.headers, 'if-none-match': '"upload"' })).statusCode,
    304,
  );
  await f.catalog.exclusive(id, async () => undefined);
  const capabilities = () => f.app.inject({ url: '/api/v1/capabilities', headers: f.headers });
  assert.equal((await capabilities()).json().transfer.length, 1);
  assert.equal(
    (await f.app.inject({ method: 'POST', url: ext + '/withdraw', headers: f.headers })).statusCode,
    200,
  );
  assert.deepEqual((await capabilities()).json().transfer, []);
  assert.equal((await get('?view=1')).statusCode, 200, 'withdrawal retains routes');
});
