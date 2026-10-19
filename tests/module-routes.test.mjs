import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { downloadSchedulePolicy } from '@proanima/arkvory-domain';
import {
  AccessScopes,
  moduleCatalog,
  AdmissionQueue,
  BandwidthGovernor,
  DownloadScheduler,
  planOrThrow,
} from '@proanima/arkvory-infrastructure';
import { EXTENSION_API_VERSION } from '../packages/extension-api/dist/index.js';
import { checkRoute, checkRoutes } from '../apps/api/dist/extension-route-check.js';
import { checkFragment } from '../apps/api/dist/extension-openapi.js';
import { ModuleRouteRegistry } from '../apps/api/dist/extension-registry.js';
import { registerExtensionRoutes } from '../apps/api/dist/extension-routes.js';
import { extensionDocument } from '../apps/api/dist/extension-documents.js';
import { moduleRoutes } from '../apps/api/dist/contract-guard.js';
import { ModuleRuntime, ModuleSetupError } from '../apps/api/dist/module-host.js';
import { createContentSender } from '../apps/api/dist/download-routes.js';
import { createDownloadAdmission } from '../apps/api/dist/download-admission.js';
import { createUploadAdmission } from '../apps/api/dist/upload-admission.js';
import { createRequestContext } from '../apps/api/dist/request-context.js';
import { registerHttpErrors } from '../apps/api/dist/http-errors.js';
import { resolveUploadTimeouts } from '../apps/api/dist/upload-policy.js';

const prefix = '/api/ext/echo/v1/';
const manifest = (overrides = {}) => ({
  format: 1,
  id: 'echo',
  version: '1.0.0',
  extensionApi: `^${EXTENSION_API_VERSION}`,
  kind: 'transfer',
  publisher: 'proanimastudio',
  core: false,
  roles: ['api', 'reader'],
  uses: ['routes'],
  requires: [],
  provides: [],
  routePrefixes: [prefix],
  metricPrefix: null,
  tablePrefix: null,
  ...overrides,
});
const json = (body) => ({ kind: 'json', status: 200, body });
const route = (overrides = {}) => ({
  method: 'GET',
  path: `${prefix}items/:id`,
  operationId: 'echo.item',
  effect: 'read',
  access: 'authenticated',
  action: null,
  repositoryParam: null,
  body: { kind: 'none' },
  responseLimit: 1024,
  timeoutMs: 1000,
  handle: async () => json({}),
  ...overrides,
});
const writing = { method: 'POST', effect: 'write' };

const refusal = (code, subject) => (error) => {
  assert.ok(error instanceof ModuleSetupError, String(error));
  assert.deepEqual([error.code, error.subject], [code, subject]);
  return true;
};

test('a route keeps the contract of the core or its module does not start', () => {
  const rows = [
    [{ method: 'HEAD' }, 'method'],
    [{ path: '/api/ext/other/v1/items/:id' }, 'path'],
    [{ path: `${prefix}../items` }, 'path'],
    [{ path: `${prefix}a/:id/:id` }, 'path'],
    [{ path: prefix }, 'path'],
    [{ path: `${prefix}Items` }, 'path'],
    [{ operationId: 'other.item' }, 'operationId'],
    [{ operationId: 'echo.' }, 'operationId'],
    [{ effect: 'write' }, 'effect'],
    [{ method: 'POST' }, 'effect'],
    // A write open to every authenticated caller is held to a writing action on a repository.
    [writing, 'action'],
    [{ ...writing, action: 'content.read', repositoryParam: 'id' }, 'action'],
    [{ action: 'upload.create', repositoryParam: 'id' }, 'action'],
    [{ action: 'content.read' }, 'action'],
    [{ action: 'content.read', repositoryParam: 'repository' }, 'repositoryParam'],
    [{ action: 'storage.manage', repositoryParam: 'id' }, 'action'],
    [{ access: 'anyone' }, 'access'],
    [{ body: { kind: 'json', limit: 10 } }, 'body'],
    [{ ...writing, access: 'administrator', body: { kind: 'json', limit: 1048577 } }, 'body/limit'],
    [{ ...writing, access: 'administrator', body: { kind: 'stream', limit: 0 } }, 'body/limit'],
    [{ ...writing, access: 'administrator', body: { kind: 'form' } }, 'body/kind'],
    [{ responseLimit: 0 }, 'responseLimit'],
    [{ responseLimit: 1.5 }, 'responseLimit'],
    [{ timeoutMs: 3_600_001 }, 'timeoutMs'],
    [{ handle: 'no' }, 'handle'],
  ];
  for (const [overrides, field] of rows)
    assert.throws(
      () => checkRoute(route(overrides), manifest(), 0),
      refusal('routes_invalid', `/routes/0/${field}`),
      JSON.stringify(overrides),
    );
  assert.throws(() => checkRoute(null, manifest(), 3), refusal('routes_invalid', '/routes/3'));
  // A route may be a class: its handler lives on the prototype.
  class Item {
    constructor() {
      const { handle: _handle, ...fields } = route();
      Object.assign(this, fields);
    }
    async handle() {
      return json({ from: 'class' });
    }
  }
  const checked = checkRoute(new Item(), manifest(), 0);
  assert.deepEqual(checked.params, ['id']);
  const admin = checkRoute(route({ ...writing, access: 'administrator' }), manifest(), 0);
  assert.equal(admin.action, null);
});

test('routes of one module are unique, bounded and cover every prefix', () => {
  const second = route({ path: `${prefix}items/:name`, operationId: 'echo.other' });
  assert.throws(
    () => checkRoutes([route(), second], manifest(), 64),
    refusal('routes_invalid', '/routes/1/path'),
  );
  assert.throws(
    () => checkRoutes([route(), route({ path: `${prefix}all` })], manifest(), 64),
    refusal('routes_invalid', '/routes/1/operationId'),
  );
  assert.throws(() => checkRoutes([route()], manifest(), 0), refusal('routes_invalid', '/routes'));
  const two = manifest({ routePrefixes: [prefix, '/api/ext/echo/v1-admin/'] });
  assert.throws(
    () => checkRoutes([route()], two, 64),
    refusal('routes_invalid', '/routePrefixes/1'),
  );
  assert.throws(
    () => checkRoutes([], manifest(), 64),
    refusal('routes_invalid', '/routePrefixes/0'),
  );
  assert.deepEqual(checkRoutes([], manifest({ routePrefixes: [] }), 64), []);
});

function operation(entry, overrides = {}) {
  return {
    operationId: entry.operationId,
    summary: 'Item',
    'x-arkvory-access': entry.access,
    responses: { 200: { description: 'Item', content: { 'application/json': { schema: {} } } } },
    ...overrides,
  };
}

function fragment(routes, overrides = {}) {
  const paths = {};
  for (const entry of routes) {
    const path = entry.path.replace(/:([a-zA-Z0-9]+)/g, '{$1}');
    paths[path] = { ...paths[path], [entry.method.toLowerCase()]: operation(entry) };
  }
  return {
    openapi: '3.1.0',
    paths,
    components: { schemas: { ext_echo_Item: { type: 'object' } } },
    ...overrides,
  };
}

test('an OpenAPI fragment is read as untrusted input and matched with the routes both ways', () => {
  const upload = route({
    ...writing,
    path: `${prefix}repositories/:repository/files`,
    operationId: 'echo.upload',
    action: 'upload.create',
    repositoryParam: 'repository',
    body: { kind: 'stream', limit: 1024 },
  });
  const routes = checkRoutes([route(), upload], manifest(), 64);
  const valid = fragment(routes);
  valid.paths[`${prefix}repositories/{repository}/files`].post.requestBody = {
    content: { 'application/octet-stream': {} },
  };
  valid.paths[`${prefix}items/{id}`].get.responses[200].content['application/json'].schema = {
    $ref: '#/components/schemas/ext_echo_Item',
  };
  valid.paths[`${prefix}items/{id}`].get.responses.default = {
    description: 'Error',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/NativeError' } } },
  };
  const checked = checkFragment(valid, manifest(), routes);
  assert.deepEqual(Object.keys(checked.schemas), ['ext_echo_Item']);
  // The core keeps a copy: a later change by the module changes nothing served.
  valid.paths[`${prefix}items/{id}`].get.summary = 'changed';
  assert.equal(checked.paths[`${prefix}items/{id}`].get.summary, 'Item');

  const item = `/paths/${`${prefix}items/{id}`.replaceAll('/', '~1')}/get`;
  const broken = (change) => {
    const copy = structuredClone(valid);
    change(copy);
    return copy;
  };
  const get = (copy) => copy.paths[`${prefix}items/{id}`].get;
  for (const [change, pointer] of [
    [(c) => (c.openapi = '3.0.3'), '/openapi'],
    [(c) => (c.servers = []), '/servers'],
    [(c) => (get(c).security = []), `${item}/security`],
    [(c) => delete get(c).summary, `${item}/summary`],
    [(c) => (get(c).responses = {}), `${item}/responses`],
    [(c) => (get(c)['x-arkvory-access'] = 'everyone'), `${item}/x-arkvory-access`],
    [(c) => (c.components.schemas.Item = {}), '/components/schemas/Item'],
    [(c) => (c.components.parameters = {}), '/components/parameters'],
    [
      (c) =>
        (get(c).responses[200].content['application/json'].schema.$ref =
          '#/components/schemas/ext_other_Item'),
      `${item}/responses/200/content/application~1json/schema/$ref`,
    ],
    [
      (c) =>
        (get(c).responses[200].content['application/json'].schema.$ref =
          'https://example.com/schema.json'),
      `${item}/responses/200/content/application~1json/schema/$ref`,
    ],
    [
      (c) =>
        (c.paths[`${prefix}repositories/{repository}/files`].post.requestBody.content = {
          'text/plain': {},
        }),
      `/paths/${`${prefix}repositories/{repository}/files`.replaceAll('/', '~1')}/post/requestBody/content`,
    ],
    [(c) => (get(c).description = 'x'.repeat(300 * 1024)), ''],
    // Keywords that move resolution elsewhere would bypass the check of `$ref`.
    ...['$id', '$schema', '$dynamicRef', '$recursiveRef'].map((keyword) => [
      (c) => (c.components.schemas.ext_echo_Item[keyword] = 'https://example.com/s.json'),
      `/components/schemas/ext_echo_Item/${keyword}`,
    ]),
  ])
    assert.throws(
      () => checkFragment(broken(change), manifest(), routes),
      refusal('openapi_invalid', pointer),
      pointer,
    );
  assert.throws(
    () => checkFragment({ ...valid, paths: { x: () => 1 } }, manifest(), routes),
    refusal('openapi_invalid', '/paths/x'),
  );
  for (const [change, subject] of [
    [(c) => delete c.paths[`${prefix}items/{id}`], `GET ${prefix}items/{id}`],
    [(c) => (c.paths[`${prefix}ghost`] = { get: operation(route()) }), `GET ${prefix}ghost`],
    [(c) => (get(c).operationId = 'echo.renamed'), `GET ${prefix}items/{id}`],
    [(c) => (get(c)['x-arkvory-access'] = 'administrator'), `GET ${prefix}items/{id}`],
    [
      (c) => delete c.paths[`${prefix}repositories/{repository}/files`].post.requestBody,
      `POST ${prefix}repositories/{repository}/files`,
    ],
  ])
    assert.throws(
      () => checkFragment(broken(change), manifest(), routes),
      refusal('openapi_route_mismatch', subject),
      subject,
    );
});

test('the registrar is open during create only; offers are checked like routes', () => {
  const registry = new ModuleRouteRegistry();
  const routes = registry.service(manifest());
  routes.add(route());
  routes.document(fragment([route()]));
  routes.offerTransfer({ name: 'echo', versions: ['1.0.0', '1.1.0'], prefix });
  registry.seal(manifest());
  assert.throws(() => routes.add(route()), TypeError);
  const [set] = registry.of(['echo', 'unknown']);
  assert.deepEqual(set.offers, [
    { name: 'echo', versions: ['1.0.0', '1.1.0'], module: 'echo', prefix },
  ]);
  assert.equal(set.routes[0].operationId, 'echo.item');

  const sealed = (id, declare, overrides = {}) => {
    const own = manifest({ id, routePrefixes: [`/api/ext/${id}/v1/`], ...overrides });
    const service = registry.service(own);
    declare(service, `/api/ext/${id}/v1/`, id);
    return () => registry.seal(own);
  };
  const item = (at, id) => route({ path: `${at}items/:id`, operationId: `${id}.item` });
  const documented = (service, at, id) => {
    service.add(item(at, id));
    service.document({ openapi: '3.1.0', paths: fragment([item(at, id)]).paths });
  };
  assert.throws(
    sealed('quiet', (s, at, id) => s.add(item(at, id))),
    refusal('openapi_invalid', ''),
  );
  assert.throws(
    sealed('twice', (s, at, id) => {
      documented(s, at, id);
      s.document({ openapi: '3.1.0', paths: {} });
    }),
    refusal('openapi_invalid', ''),
  );
  for (const [id, offer, subject, overrides] of [
    ['proto', { name: 'proto', versions: ['1.0.0'] }, '/offers/0', { kind: 'protocol' }],
    ['taken', { name: 'echo', versions: ['1.0.0'] }, '/offers/0/name'],
    ['loose', { name: 'loose', versions: ['1.x'] }, '/offers/0/versions'],
    ['many', { name: 'many', versions: ['1.0.0', '1.0.0'] }, '/offers/0/versions'],
    ['none', { name: 'none', versions: [] }, '/offers/0/versions'],
    ['away', { name: 'away', versions: ['1.0.0'], prefix }, '/offers/0/prefix'],
  ])
    assert.throws(
      sealed(
        id,
        (s, at, own) => {
          documented(s, at, own);
          s.offerTransfer({ prefix: at, ...offer });
        },
        overrides,
      ),
      refusal('transfer_invalid', subject),
      id,
    );
  assert.deepEqual(
    registry.of(['proto', 'taken', 'loose']).map((s) => s.module),
    [],
  );
});

const runtimeHost = {
  coreVersion: '1.0.0',
  extensionApi: EXTENSION_API_VERSION,
  reservedRoutePrefixes: [],
  sha256: () => 'f'.repeat(64),
  services: ['routes'],
};

function prepared(id, source, log) {
  return [
    id,
    {
      candidate: {
        manifest: manifest({ id, routePrefixes: [], kind: 'event-sink' }),
        source,
        packageSha256: source === 'builtin' ? null : 'a'.repeat(64),
        enabled: true,
        config: null,
      },
      dataClass: source === 'builtin' ? null : 'none',
      create: () => ({
        start: async () => log.push(`start ${id}`),
        drain: async () => undefined,
        stop: async () => log.push(`stop ${id}`),
        health: () => ({ status: 'ok', code: null }),
      }),
    },
  ];
}

test('a declaration that breaks the contract fails a signed module alone and stops a built-in start', async () => {
  const log = [];
  const entries = new Map([prepared('broken', 'signed', log), prepared('sound', 'signed', log)]);
  const created = (module) => {
    if (module.manifest.id === 'broken') throw new ModuleSetupError('openapi_invalid', '');
  };
  const runtime = new ModuleRuntime(planOrThrow(entries, runtimeHost), entries, {
    role: 'api',
    context: () => ({}),
    created,
  });
  await runtime.start();
  const states = Object.fromEntries(
    runtime.states().map((s) => [s.module.manifest.id, [s.running, s.health]]),
  );
  assert.deepEqual(states, {
    broken: [false, { status: 'failed', code: 'openapi_invalid' }],
    sound: [true, { status: 'ok', code: null }],
  });
  // Created, never started, stopped at once.
  assert.deepEqual(log, ['stop broken', 'start sound']);
  await runtime.shutdown(100);

  const builtin = new Map([prepared('core-routes', 'builtin', log)]);
  const failing = new ModuleRuntime(planOrThrow(builtin, runtimeHost), builtin, {
    role: 'api',
    context: () => ({}),
    created: () => {
      throw new ModuleSetupError('routes_invalid', '/routes/0');
    },
  });
  await assert.rejects(failing.start(), refusal('routes_invalid', '/routes/0'));
  assert.equal(log.at(-1), 'stop core-routes');
});

test('the contract guard compares declared module routes with the router both ways', () => {
  const module = { manifest: manifest() };
  const protocol = { manifest: manifest({ id: 'npm', routePrefixes: ['/npm/'] }) };
  const declared = new Map([['echo', [{ method: 'GET', url: `${prefix}items/:id` }]]]);
  const registered = [
    { method: 'GET', url: `${prefix}items/:id` },
    { method: 'HEAD', url: `${prefix}items/:id` },
    { method: 'GET', url: '/npm/:repository/*' },
    { method: 'GET', url: '/api/v1/capabilities' },
  ];
  assert.deepEqual(moduleRoutes(registered, [module, protocol], declared), [
    { method: 'GET', url: '/api/v1/capabilities' },
  ]);
  assert.throws(
    () =>
      moduleRoutes(
        [...registered, { method: 'POST', url: `${prefix}items/:id` }],
        [module, protocol],
        declared,
      ),
    /undocumented POST \/api\/ext\/echo\/v1\/items\/:id/,
  );
  assert.throws(
    () => moduleRoutes(registered.slice(1), [module, protocol], declared),
    /unregistered GET \/api\/ext\/echo\/v1\/items\/:id/,
  );
  // A route under no running module's prefix stays in the /api/v1 inventory, where it fails.
  assert.deepEqual(
    moduleRoutes(registered, [protocol], new Map()).slice(0, 2),
    registered.slice(0, 2),
  );
});

const content = Buffer.alloc(4096, 0x41);
const fleet = {
  id: 'fleet',
  credential: 'service-key',
  repositories: ['releases'],
  permissions: ['read', 'write'],
};

async function server(t, routes, { role = 'api', cancel } = {}) {
  const app = Fastify();
  const context = createRequestContext();
  let principal = fleet;
  app.addHook('onRequest', async (request) => {
    context.authenticate(request, principal);
  });
  const scheduler = new DownloadScheduler(downloadSchedulePolicy(1, { sessionMinBytes: 1024 }), {
    limit: 4,
    timeoutMs: 0,
  });
  const downloadGate = new AdmissionQueue(1, 4, 4, 1000, 1);
  const uploadGate = new AdmissionQueue(1, 4, 4, 1000, 1);
  const governor = new BandwidthGovernor({ bytesPerSecond: 0, perPrincipalBytesPerSecond: 0 }, [
    'fleet',
  ]);
  const sendContent = createContentSender({
    service: {
      async download() {
        return {
          upload: { descriptor: { size: content.length, sha256: 'b'.repeat(64), name: 'f.bin' } },
          async *read(range) {
            yield content.subarray(range?.start ?? 0, (range?.end ?? content.length - 1) + 1);
          },
        };
      },
    },
    admit: createDownloadAdmission({ downloadGate, downloadScheduler: scheduler }),
    downloadBandwidth: governor,
    diagnostics: { write() {} },
    principal: context.principal,
    signal: context.signal,
    pins: { acquire: async () => ({ check() {}, async release() {} }) },
  });
  const log = [];
  const scopes = new AccessScopes();
  registerHttpErrors(app, context);
  registerExtensionRoutes(
    app,
    routes.map((entry, index) => checkRoute(entry, manifest(), index)),
    {
      principal: context.principal,
      signal: (request, reply) =>
        cancel
          ? AbortSignal.any([context.signal(request, reply), cancel.signal])
          : context.signal(request, reply),
      context,
      modifying: createUploadAdmission(uploadGate, context, () => true),
      sendContent,
      bandwidth: governor,
      policy: resolveUploadTimeouts({}),
      diagnostics: { write: (record) => log.push(record) },
      role,
      downloadGate,
      downloadBandwidth: governor,
      maxObjectBytes: 1024 * 1024,
      scopes: () => scopes,
    },
  );
  t.after(async () => {
    scheduler.close();
    downloadGate.close();
    uploadGate.close();
    governor.close();
    await app.close();
  });
  return {
    app,
    scheduler,
    scopes,
    log,
    as(next) {
      principal = next;
    },
  };
}

const downloadId = (name) => ({ 'arkvory-download-id': name.padEnd(16, '0') });

test('content answers of modules queue large downloads like the core', async (t) => {
  const s = await server(t, [
    route({
      path: `${prefix}files/:id`,
      operationId: 'echo.file',
      handle: async (request) => ({
        kind: 'content',
        repository: 'releases',
        artifact: request.params.id,
      }),
    }),
  ]);
  const url = `${prefix}files/artifact`;
  const first = await s.app.inject({
    url,
    headers: { ...downloadId('first'), range: 'bytes=0-1023' },
  });
  assert.equal(first.statusCode, 206);
  assert.equal(first.headers['arkvory-download-class'], 'release');
  assert.equal(first.headers.etag, `"sha256:${'b'.repeat(64)}"`);
  const queued = await s.app.inject({ url, headers: downloadId('second') });
  assert.equal(queued.statusCode, 503);
  assert.equal(queued.json().reason, 'download_queued');
  assert.equal(queued.headers['cache-control'], undefined);
  // HEAD and 304 take no place in the queue.
  assert.equal(
    (await s.app.inject({ method: 'HEAD', url, headers: downloadId('second') })).statusCode,
    200,
  );
  const rest = await s.app.inject({
    url,
    headers: { ...downloadId('first'), range: 'bytes=1024-' },
  });
  assert.equal(rest.statusCode, 206);
  assert.equal(rest.rawPayload.length, content.length - 1024);
  s.scheduler.plan();
  const served = await s.app.inject({ url, headers: downloadId('second') });
  assert.equal(served.statusCode, 200);
  assert.deepEqual(served.rawPayload, content);
});

test('requests and answers outside the contract never reach the client as they are', async (t) => {
  let closed = 0;
  const late = {
    [Symbol.asyncIterator]() {
      return { next: async () => ({ done: true }), return: async () => (closed++, { done: true }) };
    },
  };
  const s = await server(t, [
    route({ handle: async (request) => json({ query: request.query, body: request.body.kind }) }),
    route({
      path: `${prefix}large`,
      operationId: 'echo.large',
      responseLimit: 10,
      handle: async () => json({ text: 'more than ten bytes' }),
    }),
    route({
      path: `${prefix}lie`,
      operationId: 'echo.lie',
      handle: async () => ({
        kind: 'stream',
        contentType: 'application/octet-stream',
        length: 10,
        etag: null,
        body: (async function* () {
          yield new Uint8Array(4);
        })(),
      }),
    }),
    route({
      path: `${prefix}late`,
      operationId: 'echo.late',
      timeoutMs: 20,
      handle: () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                kind: 'stream',
                contentType: 'text/plain',
                length: null,
                etag: null,
                body: late,
              }),
            60,
          ),
        ),
    }),
    route({
      ...writing,
      path: `${prefix}notes`,
      operationId: 'echo.notes',
      access: 'administrator',
      handle: async () => json({ written: true }),
    }),
  ]);
  const ok = await s.app.inject({ url: `${prefix}items/1?a=b` });
  assert.deepEqual(ok.json(), { query: { a: 'b' }, body: 'none' });
  assert.equal((await s.app.inject({ url: `${prefix}items/1?a=b&a=c` })).statusCode, 400);
  const large = await s.app.inject({ url: `${prefix}large` });
  assert.equal(large.statusCode, 500);
  assert.ok(s.log.some((r) => r.code === 'module.response_invalid' && r.module === 'echo'));
  // A length the module does not keep ends the response; the client never gets a short file.
  await assert.rejects(s.app.inject({ url: `${prefix}lie` }), /destroyed before completion/);
  assert.ok(s.log.some((r) => r.code === 'download.read_failed'));
  const timedOut = await s.app.inject({ url: `${prefix}late` });
  assert.equal(timedOut.statusCode, 503);
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(closed, 1, 'a late answer is closed unread');
  // Administrator routes refuse other principals before the handler.
  const refused = await s.app.inject({ method: 'POST', url: `${prefix}notes` });
  assert.equal(refused.json().reason, 'administrator_required');
  s.as({ ...fleet, administrator: true });
  const body = await s.app.inject({
    method: 'POST',
    url: `${prefix}notes`,
    headers: { 'content-type': 'application/json' },
    payload: '{"x":1}',
  });
  assert.equal(body.statusCode, 400, 'a route without a body takes none');
  const written = await s.app.inject({ method: 'POST', url: `${prefix}notes` });
  assert.deepEqual(written.json(), { written: true });

  const gateway = await server(
    t,
    [route({ ...writing, access: 'administrator', path: `${prefix}notes` })],
    {
      role: 'reader',
    },
  );
  gateway.as({ ...fleet, administrator: true });
  const readOnly = await gateway.app.inject({ method: 'POST', url: `${prefix}notes` });
  assert.equal(readOnly.json().code, 'read_only');
});

test('an answer that throws while the core reads it fails the request, never the process', async (t) => {
  const rejections = [];
  const record = (reason) => rejections.push(reason);
  process.on('unhandledRejection', record);
  t.after(() => process.off('unhandledRejection', record));
  // A getter that throws, as an answer class whose body was already taken would.
  const hostile = () => ({
    kind: 'stream',
    contentType: 'text/plain',
    length: null,
    etag: null,
    get body() {
      throw new Error('body already taken');
    },
  });
  const s = await server(t, [
    route({ path: `${prefix}now`, operationId: 'echo.now', handle: async () => hostile() }),
    route({
      path: `${prefix}later`,
      operationId: 'echo.later',
      timeoutMs: 20,
      handle: () => new Promise((resolve) => setTimeout(() => resolve(hostile()), 60)),
    }),
  ]);
  const now = await s.app.inject({ url: `${prefix}now` });
  assert.equal(now.statusCode, 500);
  assert.ok(s.log.some((r) => r.code === 'module.response_invalid' && r.module === 'echo'));
  assert.equal((await s.app.inject({ url: `${prefix}later` })).statusCode, 503);
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.deepEqual(rejections, [], 'a late answer the core cannot close is dropped quietly');
});

test('stream answers never carry a script type; immutable caching only for the bytes', async (t) => {
  const typed = (contentType) =>
    route({
      path: `${prefix}typed/:n`,
      operationId: 'echo.typed',
      handle: async () => ({
        kind: 'stream',
        contentType,
        length: 0,
        etag: null,
        body: (async function* () {})(),
      }),
    });
  for (const type of ['text/jscript', 'text/livescript', 'application/x-javascript']) {
    const s = await server(t, [typed(type)]);
    assert.equal((await s.app.inject({ url: `${prefix}typed/1` })).statusCode, 500, type);
  }
  const s = await server(t, [
    route({
      path: `${prefix}files/:id`,
      operationId: 'echo.file',
      handle: async (request) => ({
        kind: 'content',
        repository: 'releases',
        artifact: request.params.id,
        cache: 'immutable',
      }),
    }),
  ]);
  const url = `${prefix}files/artifact`;
  const whole = await s.app.inject({ url });
  assert.equal(whole.statusCode, 200);
  assert.equal(whole.headers['cache-control'], 'private, max-age=31536000, immutable');
  const unsatisfiable = await s.app.inject({ url, headers: { range: 'bytes=9000-' } });
  assert.equal(unsatisfiable.statusCode, 416);
  assert.equal(unsatisfiable.headers['cache-control'], 'private, no-store');
});

test('the combined document shows a caller only what it may call', () => {
  const routes = checkRoutes(
    [
      route(),
      route({
        ...writing,
        access: 'administrator',
        path: `${prefix}notes`,
        operationId: 'echo.notes',
      }),
    ],
    manifest(),
    64,
  );
  const declared = fragment(routes);
  const schema = (name) => ({ $ref: `#/components/schemas/${name}` });
  declared.paths[`${prefix}items/{id}`].get.responses[200].content['application/json'].schema =
    schema('ext_echo_Item');
  declared.paths[`${prefix}notes`].post.responses[200].content['application/json'].schema =
    schema('ext_echo_Note');
  declared.components.schemas = {
    ext_echo_Item: { type: 'object' },
    ext_echo_Note: { type: 'object', properties: { part: schema('ext_echo_Part') } },
    ext_echo_Part: { type: 'object' },
    ext_echo_Spare: { type: 'object' },
  };
  const set = {
    module: 'echo',
    routes,
    fragment: checkFragment(declared, manifest(), routes),
    offers: [],
  };
  const all = extensionDocument([set], 'c'.repeat(64), () => true);
  assert.deepEqual(Object.keys(all.paths).sort(), [`${prefix}items/{id}`, `${prefix}notes`]);
  assert.equal(all.info.version, 'c'.repeat(64));
  assert.deepEqual(all.paths[`${prefix}notes`].post.security, [{ serviceKey: [] }]);
  // Schemas follow the operations shown: a referenced one, and what it refers to in turn.
  assert.deepEqual(Object.keys(all.components.schemas).sort(), [
    'NativeError',
    'ext_echo_Item',
    'ext_echo_Note',
    'ext_echo_Part',
  ]);
  const reads = extensionDocument([set], 'c'.repeat(64), (r) => r.effect === 'read');
  assert.deepEqual(Object.keys(reads.paths), [`${prefix}items/{id}`]);
  // The shapes of operations a caller may not call are not disclosed either.
  assert.deepEqual(Object.keys(reads.components.schemas).sort(), ['NativeError', 'ext_echo_Item']);
});

for (const mode of [
  'json',
  'stream',
  'head',
  'cached',
  'error',
  'invalid',
  'throw',
  'timeout',
  'abort',
]) {
  test(`request scope and its intersections release content pins on ${mode}`, async (t) => {
    let held,
      child,
      releases = 0;
    const cancel = new AbortController();
    const s = await server(
      t,
      [
        route({
          timeoutMs: 20,
          handle: async (request) => {
            assert.equal(s.scopes.principalsOf(request.scope)[0].id, fleet.id);
            child = s.scopes.intersect(request.scope, s.scopes.of([fleet]));
            child = s.scopes.intersect(child, request.scope);
            const { content: reader } = moduleCatalog(
              {
                content: async () => ({
                  upload: { descriptor: { size: 1, sha256: 'a'.repeat(64) } },
                  pin: {
                    check() {},
                    async release() {
                      releases++;
                    },
                  },
                  async *read() {
                    yield new Uint8Array([42]);
                  },
                }),
              },
              s.scopes,
            );
            held = await reader.open(child, { repository: 'releases', id: 'item' });
            if (mode === 'timeout') {
              await new Promise((resolve) => setTimeout(resolve, 60));
              return json({});
            }
            if (mode === 'abort') {
              cancel.abort();
              return json({});
            }
            if (mode === 'throw') throw new Error('broken');
            if (mode === 'invalid') return { kind: 'bogus' };
            if (mode === 'error') return { kind: 'error', code: 'conflict' };
            if (mode === 'json') return json({});
            return {
              kind: 'stream',
              contentType: 'application/octet-stream',
              length: 1,
              etag: '"one"',
              body: {
                async *[Symbol.asyncIterator]() {
                  assert.equal(
                    s.scopes.principalsOf(child).length,
                    3,
                    'scope lives during lazy response',
                  );
                  yield* held.read();
                },
              },
            };
          },
        }),
      ],
      { cancel },
    );
    const response = await s.app.inject({
      url: prefix + 'items/id',
      method: mode === 'head' ? 'HEAD' : 'GET',
      headers: mode === 'cached' ? { 'if-none-match': '"one"' } : {},
    });
    assert.equal(
      response.statusCode,
      { error: 409, invalid: 500, throw: 500, timeout: 503, abort: 503, cached: 304 }[mode] ?? 200,
      response.body,
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(releases, 1);
    assert.deepEqual(s.scopes.principalsOf(child), []);
    await assert.rejects(
      async () => {
        for await (const chunk of held.read()) void chunk;
      },
      { code: 'unavailable' },
    );
    await held.release();
    assert.equal(releases, 1);
  });
}

test('withdrawal updates an existing route set without releasing the name or deleting routes', () => {
  const registry = new ModuleRouteRegistry();
  const own = manifest();
  const service = registry.service(own);
  service.add(route());
  service.document(fragment([route()]));
  service.offerTransfer({ name: 'echo', versions: ['1.0.0'], prefix });
  registry.seal(own);
  const [set] = registry.of(['echo']);
  assert.equal(set.offers.length, 1);
  service.withdrawTransfer('foreign');
  assert.equal(set.offers.length, 1);
  service.withdrawTransfer('echo');
  service.withdrawTransfer('echo');
  assert.equal(set.offers.length, 0);
  assert.equal(set.routes.length, 1);
  assert.throws(() => service.offerTransfer({ name: 'echo', versions: ['1.0.0'], prefix }));
  const other = manifest({ id: 'other', routePrefixes: ['/api/ext/other/v1/'] });
  const registrar = registry.service(other);
  const otherRoute = route({ path: '/api/ext/other/v1/items/:id', operationId: 'other.item' });
  registrar.add(otherRoute);
  registrar.document({ openapi: '3.1.0', paths: fragment([otherRoute]).paths });
  registrar.offerTransfer({ name: 'echo', versions: ['1.0.0'], prefix: '/api/ext/other/v1/' });
  assert.throws(() => registry.seal(other), refusal('transfer_invalid', '/offers/0/name'));
});
