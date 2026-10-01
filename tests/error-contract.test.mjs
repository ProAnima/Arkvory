// Error contract (ADR 0051): one closed code/reason set across domain, wire, HTTP and SDK.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import {
  ArkvoryError,
  ThrottledError,
  errorReasons as domainReasons,
  detailProblems as domainProblems,
  fieldError,
  nestedFields,
  parsePromotionRequest,
  parseStoragePolicyUpdate,
  withField,
} from '@proanima/arkvory-domain';
import {
  errorCodes,
  errorReasons as wireReasons,
  detailProblems as wireProblems,
  nativeErrorSchema,
  openApiDocument,
  readNativeError,
} from '@proanima/arkvory-contracts';
import {
  ArkvoryClient,
  ArkvoryClientError,
  ArkvoryHttpError,
  ArkvoryNetworkError,
} from '@proanima/arkvory-sdk';
import { createHttpServer } from '../apps/api/dist/http-server.js';
import { registerHttpErrors, httpStatus } from '../apps/api/dist/http-errors.js';
import { registerNotFound, routePattern } from '../apps/api/dist/not-found.js';
import { fields } from '../apps/api/dist/body-fields.js';
import { createRequestContext } from '../apps/api/dist/request-context.js';
import { validateJson } from './api-schema.mjs';

test('domain and wire share one closed code, reason and problem set', () => {
  assert.deepEqual(wireReasons, domainReasons);
  assert.deepEqual([...errorCodes], Object.keys(domainReasons));
  assert.deepEqual([...wireProblems], [...domainProblems]);
  assert.deepEqual(nativeErrorSchema.properties.code.enum, errorCodes);
  for (const code of ['read_only', 'rate_limited']) assert.ok(errorCodes.includes(code), code);
  // Every reason belongs to exactly one code, so a reason alone never changes meaning.
  const all = Object.values(domainReasons).flat();
  assert.equal(new Set(all).size, all.length);
  assert.deepEqual(openApiDocument.components.schemas.NativeError, nativeErrorSchema);
});

test('ArkvoryError bounds details and normalizes Retry-After seconds', () => {
  const details = Array.from({ length: 40 }, (_, i) => ({ field: `/f${i}`, problem: 'invalid' }));
  const error = new ArkvoryError('invalid_input', 'x', { details });
  assert.equal(error.details.length, 16);
  assert.equal(error.reason, undefined);
  const throttled = new ThrottledError(2.2, 'password_attempts');
  assert.deepEqual(
    [throttled.code, throttled.reason, throttled.retryAfterSeconds],
    ['rate_limited', 'password_attempts', 3],
  );
  assert.ok(throttled instanceof ArkvoryError);
});

test('validators name the failing member without echoing its value', () => {
  assert.throws(
    () =>
      withField('/name', () => {
        throw fieldError('/ignored', 'format', 'kept');
      }),
    (e) => e.details[0].field === '/ignored',
    'an already named failure keeps its field',
  );
  assert.throws(
    () =>
      withField('/name', () => {
        throw new ArkvoryError('invalid_input', 'Invalid account name');
      }),
    (e) =>
      e.reason === 'validation' &&
      e.message === 'Invalid account name' &&
      JSON.stringify(e.details) === JSON.stringify([{ field: '/name', problem: 'invalid' }]),
  );
  assert.throws(
    () =>
      withField('/name', () => {
        throw new TypeError('defect');
      }),
    TypeError,
    'non-domain failures pass through',
  );
  assert.throws(
    () => parsePromotionRequest({ target: 'Bad Repo!' }),
    (e) => e.reason === 'validation' && e.details[0].field === '/target',
  );
  assert.throws(
    () => parsePromotionRequest({ target: 'prod', secret: 'value' }),
    (e) => e.details[0].field === '/secret' && e.details[0].problem === 'unknown_field',
  );
  assert.throws(
    () =>
      parseStoragePolicyUpdate({
        expectedRevision: 0,
        policy: {
          enabled: false,
          grouping: 'package',
          keepLast: 5,
          channels: [],
          protectedLabels: [],
          minAgeHours: 1,
          intervalMinutes: 5,
          quotaBytes: '12x',
          warningPercent: 80,
          criticalPercent: 95,
        },
      }),
    (e) => e.details[0].field === '/policy/quotaBytes' && e.details[0].problem === 'format',
  );
  for (const [inner, outer] of [
    ['/', '/value'],
    ['/labels', '/value/labels'],
  ])
    assert.throws(
      () =>
        nestedFields('/value', () => {
          throw fieldError(inner, 'type', 'x');
        }),
      (e) => e.details[0].field === outer,
    );
  assert.throws(
    () =>
      fields({ name: 'a', extra: 1, 'a/b': 2 }, ['name', 'password'], { required: ['password'] }),
    (e) =>
      JSON.stringify(e.details) ===
      JSON.stringify([
        { field: '/extra', problem: 'unknown_field' },
        { field: '/a~1b', problem: 'unknown_field' },
        { field: '/password', problem: 'required' },
      ]),
  );
  assert.throws(
    () => fields({ after: 'x', other: 'y' }, ['after'], { in: 'query' }),
    (e) => e.details[0].field === 'other',
  );
});

function failingServer(t, role = 'api') {
  const app = createHttpServer();
  const context = createRequestContext();
  registerNotFound(app, context, role);
  registerHttpErrors(app, context);
  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Request-Id', request.id);
  });
  const failures = {
    busy: () => new ArkvoryError('busy', 'Transfer queue is full'),
    throttled: () => new ThrottledError(17, 'login_attempts'),
    quota: () =>
      new ArkvoryError('capacity_exceeded', 'Repository storage quota exceeded', {
        reason: 'storage_quota',
      }),
    plain: () => new ArkvoryError('invalid_input', 'Invalid repository'),
  };
  for (const [name, failure] of Object.entries(failures))
    app.get(`/fail/${name}`, async () => {
      throw failure();
    });
  app.post('/json', async (request) => fields(request.body, ['name'], { required: ['name'] }));
  app.post(
    '/schema',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'size'],
          properties: { name: { type: 'string', minLength: 3 }, size: { type: 'integer' } },
        },
        querystring: {
          type: 'object',
          properties: { limit: { type: 'integer', maximum: 10 } },
        },
      },
    },
    async () => ({ ok: true }),
  );
  t.after(() => app.close());
  return app;
}

const expectEnvelope = (response, status, code, reason) => {
  assert.equal(response.statusCode, status, response.body);
  const body = response.json();
  validateJson(nativeErrorSchema, body);
  assert.equal(body.code, code);
  assert.equal(body.reason, reason);
  assert.equal(body.requestId, response.headers['x-request-id']);
  return body;
};

test('HTTP layer maps Fastify request failures to statuses with reasons and named fields', async (t) => {
  const app = failingServer(t);
  const json = { 'content-type': 'application/json' };
  expectEnvelope(
    await app.inject({ method: 'POST', url: '/json', headers: json, payload: 'x'.repeat(70000) }),
    413,
    'invalid_input',
    'body_too_large',
  );
  expectEnvelope(
    await app.inject({
      method: 'POST',
      url: '/json',
      headers: { 'content-type': 'application/xml' },
      payload: '<a/>',
    }),
    415,
    'invalid_input',
    'unsupported_media_type',
  );
  expectEnvelope(
    await app.inject({ method: 'POST', url: '/json', headers: json, payload: '{"name":' }),
    400,
    'invalid_input',
    'malformed_json',
  );
  const missing = expectEnvelope(
    await app.inject({ method: 'POST', url: '/json', payload: { other: 1 } }),
    400,
    'invalid_input',
    'validation',
  );
  assert.deepEqual(missing.details, [
    { field: '/other', problem: 'unknown_field' },
    { field: '/name', problem: 'required' },
  ]);
  // Fastify validates with allErrors off: the first failing keyword is reported per request.
  for (const [payload, detail] of [
    [{ name: 'abc' }, { field: '/size', problem: 'required' }],
    [
      { name: 'abc', size: 1, extra: true },
      { field: '/extra', problem: 'unknown_field' },
    ],
    [
      { name: 'ab', size: 1 },
      { field: '/name', problem: 'length' },
    ],
    [
      { name: 'abc', size: 'one' },
      { field: '/size', problem: 'type' },
    ],
  ]) {
    const body = expectEnvelope(
      await app.inject({ method: 'POST', url: '/schema', payload }),
      400,
      'invalid_input',
      'validation',
    );
    assert.deepEqual(body.details, [detail], JSON.stringify(payload));
  }
  const query = expectEnvelope(
    await app.inject({ method: 'POST', url: '/schema?limit=x', payload: { name: 'abc', size: 1 } }),
    400,
    'invalid_input',
    'validation',
  );
  assert.deepEqual(query.details, [{ field: 'limit', problem: 'type' }]);
  // Deliberate input errors without a refinement read as validation.
  expectEnvelope(await app.inject({ url: '/fail/plain' }), 400, 'invalid_input', 'validation');
});

test('Retry-After and retryAfterSeconds agree; capacity reasons survive the wire', async (t) => {
  const app = failingServer(t);
  const busy = await app.inject({ url: '/fail/busy' });
  assert.equal(expectEnvelope(busy, 503, 'busy', undefined).retryAfterSeconds, 2);
  assert.equal(busy.headers['retry-after'], '2');
  const throttled = await app.inject({ url: '/fail/throttled' });
  const body = expectEnvelope(throttled, 429, 'rate_limited', 'login_attempts');
  assert.equal(body.retryAfterSeconds, 17);
  assert.equal(throttled.headers['retry-after'], '17');
  const quota = await app.inject({ url: '/fail/quota' });
  assert.equal(
    expectEnvelope(quota, 507, 'capacity_exceeded', 'storage_quota').retryAfterSeconds,
    undefined,
  );
  assert.equal(quota.headers['retry-after'], undefined);
  assert.equal(httpStatus({ code: 'read_only' }), 405);
  assert.equal(httpStatus({ code: 'invalid_input', reason: 'range_not_satisfiable' }), 416);
  assert.equal(httpStatus({ code: 'invalid_input', reason: 'validation' }), 400);
});

test('unmatched URLs are 404 without echo; a known path with another method is 405 + Allow', async (t) => {
  const app = failingServer(t);
  const unknown = await app.inject({ url: '/api/v1/no-such-thing/%3Cscript%3E?token=secret' });
  const body = expectEnvelope(unknown, 404, 'not_found', 'route_not_found');
  assert.doesNotMatch(unknown.body, /no-such-thing|script|secret/);
  assert.equal(body.message, 'No API operation at this path');
  const wrong = await app.inject({ method: 'DELETE', url: '/json' });
  expectEnvelope(wrong, 405, 'invalid_input', 'method_not_allowed');
  assert.equal(wrong.headers.allow, 'POST');
  const head = await app.inject({ method: 'PUT', url: '/fail/busy' });
  assert.equal(head.headers.allow, 'GET, HEAD');
  // A read gateway answers unmatched mutations as it answers matched ones.
  const reader = failingServer(t, 'reader');
  const refused = await reader.inject({ method: 'DELETE', url: '/json' });
  expectEnvelope(refused, 405, 'read_only', undefined);
  assert.equal(refused.headers.allow, 'GET, HEAD');
  expectEnvelope(await reader.inject({ url: '/elsewhere' }), 404, 'not_found', 'route_not_found');
  assert.ok(
    routePattern('/api/v1/repositories/:repository/packages/*').test(
      '/api/v1/repositories/r/packages/a/b',
    ),
  );
  assert.equal(routePattern('/a/:id').test('/a/b/c'), false);
});

async function serve(t, handler) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await new Promise((done) => server.once('listening', done));
  t.after(
    () =>
      new Promise((done) => {
        server.close(done);
        server.closeAllConnections();
      }),
  );
  return `http://127.0.0.1:${server.address().port}`;
}

test('SDK keeps server code, reason, details and message apart from Error.message', async (t) => {
  const answers = [
    [
      409,
      { 'content-type': 'application/json', 'x-request-id': 'header-id' },
      JSON.stringify({
        code: 'conflict',
        reason: 'upload_expired',
        message: 'Upload has expired',
        requestId: 'body-id',
        details: [{ field: '/name', problem: 'invalid' }, { field: 7 }],
      }),
    ],
    [502, { 'content-type': 'text/html', 'x-request-id': 'proxy-id' }, '<h1>Bad gateway</h1>'],
    [
      429,
      { 'content-type': 'application/json' },
      JSON.stringify({
        code: 'rate_limited',
        reason: 'reason_from_the_future',
        message: 'Too many',
        requestId: 'r',
        retryAfterSeconds: 9,
      }),
    ],
  ];
  const events = [];
  const url = await serve(t, (req, res) => {
    const [status, headers, body] = answers.shift();
    res.writeHead(status, headers);
    res.end(body);
  });
  const client = new ArkvoryClient(url, () => 'secret-test-credential', {
    maxAttempts: 1,
    onRequest: (event) => events.push(event),
  });
  const conflict = await client.identity.me().catch((e) => e);
  assert.ok(conflict instanceof ArkvoryHttpError);
  assert.equal(conflict.name, 'ArkvoryHttpError');
  assert.deepEqual(
    [conflict.status, conflict.code, conflict.reason, conflict.requestId],
    [409, 'conflict', 'upload_expired', 'body-id'],
  );
  assert.equal(conflict.serverMessage, 'Upload has expired');
  assert.doesNotMatch(conflict.message, /expired/);
  assert.deepEqual(conflict.details, [{ field: '/name', problem: 'invalid' }]);
  const proxy = await client.identity.me().catch((e) => e);
  assert.deepEqual(
    [proxy.status, proxy.code, proxy.requestId, proxy.serverMessage, proxy.reason],
    [502, 'http_error', 'proxy-id', '', undefined],
  );
  const limited = await client.identity.me().catch((e) => e);
  assert.equal(limited.reason, 'reason_from_the_future', 'unknown reasons are tolerated');
  assert.equal(limited.retryAfterMs, 9000);
  assert.equal(limited.retryAfterSeconds, 9);
  assert.deepEqual(
    events.map(({ method, path, status, requestId }) => [method, path, status, requestId]),
    [
      ['GET', '/api/v1/auth/me', 409, 'header-id'],
      ['GET', '/api/v1/auth/me', 502, 'proxy-id'],
      ['GET', '/api/v1/auth/me', 429, undefined],
    ],
  );
  assert.doesNotMatch(JSON.stringify(events), /secret-test-credential/);
  assert.ok(events.every((event) => Number.isInteger(event.durationMs)));
});

test('SDK local failures are typed client errors; the envelope reader is lenient', async (t) => {
  assert.throws(
    () => new ArkvoryClient('http://example.com', () => ''),
    (e) => e instanceof ArkvoryClientError && e.code === 'insecure_url',
  );
  const url = await serve(t, (req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        id: 'u',
        repository: 'releases',
        status: 'pending',
        createdAt: '2026-01-01T00:00:00Z',
        expiresAt: '2026-01-02T00:00:00Z',
        descriptor: { name: 'a', size: '5', sha256: '0'.repeat(64), labels: [], metadata: {} },
      }),
    );
  });
  const client = new ArkvoryClient(url, () => 'k');
  assert.throws(
    () => client.inRepository('Bad Repo'),
    (e) => e instanceof ArkvoryClientError && e.code === 'invalid_argument',
  );
  const mismatch = await client.resume('releases', 'u', new Blob(['abc'])).catch((e) => e);
  assert.ok(mismatch instanceof ArkvoryClientError);
  assert.equal(mismatch.code, 'size_mismatch');
  assert.equal(mismatch.message, 'File size differs from upload');
  assert.equal(new ArkvoryNetworkError().name, 'ArkvoryNetworkError');
  assert.throws(() => readNativeError({ message: 'no code' }));
  assert.deepEqual(readNativeError({ code: 'busy', requestId: 7, details: 'x', reason: 'Bad!' }), {
    code: 'busy',
    message: '',
    requestId: '',
  });
});
