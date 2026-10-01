import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { ArkvoryError } from '@proanima/arkvory-domain';
import {
  AdmissionQueue,
  classifyFailure,
  failureCause,
  redactDiagnostic,
  startupReason,
  storageReserveBytes,
} from '@proanima/arkvory-infrastructure';
import { createHttpServer } from '../apps/api/dist/http-server.js';
import { registerHttpErrors } from '../apps/api/dist/http-errors.js';
import { createRequestContext } from '../apps/api/dist/request-context.js';
import { ResponseDiagnostics } from '../apps/api/dist/response-diagnostics.js';
import { registerAccessLog } from '../apps/api/dist/access-log.js';
import { RequestDrain, drainThenClose } from '../apps/api/dist/drain.js';
import { ReadinessProbe } from '../apps/api/dist/readiness.js';
import { readOperability } from '../apps/api/dist/operability-config.js';
import { loadConfig } from '../apps/api/dist/index.js';

const secret = 'postgresql://arkvory:TopSecretPassword1@db.internal:5432/arkvory';
const systemError = (code) => Object.assign(new Error(`${code} at ${secret}`), { code });
const pgError = (code) =>
  Object.assign(new Error(`failure for ${secret}`), { name: 'error', code, severity: 'FATAL' });

test('failure classification separates defects from transient and capacity failures', async () => {
  assert.equal(classifyFailure(systemError('ENOSPC')), 'storage_full');
  assert.equal(classifyFailure(systemError('EDQUOT')), 'storage_full');
  assert.equal(classifyFailure(pgError('53100')), 'storage_full');
  for (const code of ['57P01', '57P02', '57P03', '08006', '08001', '53300', '40001', '57014'])
    assert.equal(classifyFailure(pgError(code)), 'dependency_unavailable', code);
  for (const code of ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT'])
    assert.equal(classifyFailure(systemError(code)), 'dependency_unavailable', code);
  assert.equal(
    classifyFailure(new Error('Connection terminated unexpectedly')),
    'dependency_unavailable',
  );
  assert.equal(classifyFailure(new DOMException('aborted', 'AbortError')), 'cancelled');
  assert.equal(classifyFailure(pgError('P0001')), 'unexpected');
  assert.equal(classifyFailure(new TypeError('x is not a function')), 'unexpected');
  // A subclass with the same text is not the driver failure.
  assert.equal(classifyFailure(new TypeError('Connection terminated unexpectedly')), 'unexpected');
  assert.deepEqual(failureCause(pgError('57P01')), { errorName: 'error', sqlstate: '57P01' });
  assert.deepEqual(failureCause(systemError('EPIPE')), { errorName: 'Error', errno: 'EPIPE' });
  assert.deepEqual(failureCause('text'), { errorName: 'string' });
  // The code-less driver texts must still exist in the installed pg/pg-pool versions.
  const require = createRequire(import.meta.url);
  const pg = await readFile(join(dirname(require.resolve('pg')), 'client.js'), 'utf8');
  const pool = await readFile(require.resolve('pg-pool'), 'utf8');
  for (const message of ['Connection terminated unexpectedly', 'Query read timeout'])
    assert.ok(pg.includes(message), message);
  for (const message of [
    'timeout exceeded when trying to connect',
    'Connection terminated due to connection timeout',
  ])
    assert.ok(pool.includes(message), message);
});

test('startup reasons keep validation text but never URLs, credentials or library messages', () => {
  assert.equal(startupReason(new Error('Invalid ARKVORY_PORT')), 'Invalid ARKVORY_PORT');
  assert.equal(
    startupReason(new ArkvoryError('unavailable', 'Storage is owned by another process')),
    'unavailable: Storage is owned by another process',
  );
  assert.equal(startupReason(pgError('28P01')), 'database authentication failed');
  assert.equal(startupReason(pgError('42P01')), 'database schema is missing; run migrations');
  assert.equal(startupReason(pgError('57P03')), 'dependency unavailable');
  assert.equal(startupReason(systemError('ECONNREFUSED')), 'dependency unavailable');
  assert.equal(startupReason(systemError('EACCES')), 'system call failed');
  assert.equal(
    startupReason(new SyntaxError(`Unexpected token in ${secret}`)),
    'unexpected failure',
  );
  const redacted = startupReason(new Error(`Cannot reach ${secret} password=hunter2 token: abc`));
  assert.doesNotMatch(redacted, /TopSecret|hunter2|abc|db\.internal/);
  assert.doesNotMatch(redactDiagnostic('arkvory_' + 'k'.repeat(40)), /k{8}/);
  assert.ok(redactDiagnostic('x'.repeat(1000)).length <= 240);
});

async function errorServer(t) {
  const app = createHttpServer();
  const records = [];
  const context = createRequestContext();
  const diagnostics = new ResponseDiagnostics(
    { write: (record) => records.push(record), close() {} },
    { recordEvent: async () => undefined },
    context,
  );
  app.addHook('onResponse', async (request, reply) => {
    diagnostics.record(request, reply);
  });
  registerHttpErrors(app, context);
  const failures = {
    defect: () => new TypeError(`cannot read ${secret}`),
    full: () => systemError('ENOSPC'),
    shutdown: () => pgError('57P01'),
    refused: () => systemError('ECONNREFUSED'),
    busy: () => new ArkvoryError('busy', 'Transfer queue is full'),
    client: () => Object.assign(new Error('bad body'), { statusCode: 415 }),
  };
  for (const [name, failure] of Object.entries(failures))
    app.get(`/${name}`, async () => {
      throw failure();
    });
  t.after(() => app.close());
  return { app, records };
}

test('HTTP errors: defects are 500 internal without Retry-After; only transient states invite retry', async (t) => {
  const { app, records } = await errorServer(t);
  const expected = {
    defect: [500, 'internal', false],
    full: [507, 'capacity_exceeded', false],
    shutdown: [503, 'unavailable', true],
    refused: [503, 'unavailable', true],
    busy: [503, 'busy', true],
    client: [400, 'invalid_input', false],
  };
  for (const [name, [status, code, retry]] of Object.entries(expected)) {
    const response = await app.inject({ url: `/${name}` });
    assert.equal(response.statusCode, status, name);
    assert.equal(response.json().code, code, name);
    assert.equal(response.headers['retry-after'] !== undefined, retry, name);
    assert.doesNotMatch(response.body, /TopSecret|db\.internal|cannot read/);
  }
  const logged = Object.fromEntries(records.map((r) => [r.route, r]));
  assert.deepEqual(
    [logged['/defect'].code, logged['/defect'].errorName, logged['/defect'].errno],
    ['internal', 'TypeError', undefined],
  );
  assert.equal(logged['/shutdown'].sqlstate, '57P01');
  assert.equal(logged['/full'].errno, 'ENOSPC');
  assert.equal(logged['/busy'].errorName, undefined, 'deliberate errors carry no cause');
  assert.doesNotMatch(JSON.stringify(records), /TopSecret|db\.internal|cannot read/);
});

test('access log records route templates, status, timing and principal but never query strings', async (t) => {
  const app = createHttpServer();
  const records = [];
  let clock = 1000;
  registerAccessLog(app, {
    writer: { write: (record) => records.push(record) },
    principal: (request) => (request.headers.authorization ? { id: 'user:alice' } : undefined),
    now: () => (clock += 7),
  });
  app.get('/items/:id', async () => ({ ok: true }));
  app.get('/health/live', async () => ({ status: 'ok' }));
  t.after(() => app.close());
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  await (
    await fetch(`${address}/items/42?token=secret-value`, { headers: { authorization: 'x' } })
  ).text();
  await (await fetch(`${address}/health/live`)).text();
  await (await fetch(`${address}/missing?key=secret-value`)).text();
  // Records are written on the server response 'close', which may trail the client body.
  for (let i = 0; i < 100 && records.length < 2; i++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(records.length, 2, 'successful public probes are not logged');
  const [item, missing] = records;
  assert.equal(item.code, 'http.access');
  assert.equal(item.route, '/items/:id');
  assert.equal(item.status, 200);
  assert.ok(item.durationMs > 0 && item.durationMs % 7 === 0, 'injected monotonic clock');
  assert.equal(item.principal, 'user:alice');
  assert.equal(item.completed, true);
  assert.ok(item.bytesSent > 0);
  assert.equal(item.clientIp, '127.0.0.1');
  assert.equal(missing.route, 'unmatched');
  assert.equal(missing.principal, undefined);
  assert.doesNotMatch(JSON.stringify(records), /secret-value|token|\/items\/42/);
});

test('drain waits for tracked responses, honours timeout and abort, then closes', async () => {
  const drain = new RequestDrain();
  const listeners = [];
  const response = { once: (_event, listener) => listeners.push(listener) };
  let begun = 0;
  drain.onBegin(() => begun++);
  assert.equal(await drain.settle(1000), true, 'idle drain settles at once');
  drain.track(response);
  assert.equal(await drain.settle(10), false, 'timeout reports unfinished work');
  const controller = new AbortController();
  const aborted = drain.settle(60000, controller.signal);
  controller.abort();
  assert.equal(await aborted, false);
  let closed = 0;
  const pending = drainThenClose({ close: async () => closed++ }, drain, 60000);
  assert.equal(drain.isDraining, true);
  assert.equal(begun, 1);
  assert.equal(closed, 0, 'close waits for the admitted response');
  listeners[0]();
  assert.equal(await pending, true);
  assert.equal(closed, 1);
  assert.equal(drain.activeRequests, 0);
});

test('admission drain rejects queued and new transfers as busy while active ones finish', async () => {
  const gate = new AdmissionQueue(1, 4, 4, 5000, 1);
  const release = await gate.acquire('a');
  const queued = gate.acquire('b');
  gate.drain();
  await assert.rejects(queued, { code: 'busy' });
  await assert.rejects(gate.acquire('c'), { code: 'busy' });
  assert.equal(gate.idle, false);
  release();
  assert.equal(gate.idle, true);
  assert.equal(gate.snapshot.rejected, 2);
});

test('public readiness is single-flight, cached and reports draining immediately', async () => {
  let checks = 0;
  let healthy = true;
  let draining = false;
  let now = 0;
  const probe = new ReadinessProbe(
    async () => {
      checks++;
      if (!healthy) throw new Error('down');
    },
    () => draining,
    () => now,
    1000,
  );
  assert.deepEqual(await Promise.all([probe.status(), probe.status()]), ['ready', 'ready']);
  assert.equal(checks, 1);
  healthy = false;
  now = 500;
  assert.equal(await probe.status(), 'ready', 'cached within the TTL');
  now = 1500;
  assert.equal(await probe.status(), 'unavailable');
  draining = true;
  assert.equal(await probe.status(), 'draining');
  assert.equal(checks, 2);
});

test('operability settings validate pool, request budget, reserve, access log and drain window', async () => {
  const transfers = { maxUploads: 2, maxDownloads: 16 };
  assert.deepEqual(readOperability({}, transfers), {
    databasePoolSize: 10,
    maxRequests: 128,
    storageReserveBytes: 1024 ** 3,
    accessLog: true,
    drainTimeoutMs: 30000,
  });
  assert.equal(readOperability({}, { maxUploads: 32, maxDownloads: 256 }).maxRequests, 352);
  const env = {
    ARKVORY_DATABASE_POOL_SIZE: '24',
    ARKVORY_MAX_REQUESTS: '19',
    ARKVORY_STORAGE_RESERVE_BYTES: '0',
    ARKVORY_ACCESS_LOG: 'false',
    ARKVORY_DRAIN_TIMEOUT_MS: '0',
  };
  assert.deepEqual(readOperability(env, transfers), {
    databasePoolSize: 24,
    maxRequests: 19,
    storageReserveBytes: 0,
    accessLog: false,
    drainTimeoutMs: 0,
  });
  for (const [name, value] of [
    ['ARKVORY_DATABASE_POOL_SIZE', '3'],
    ['ARKVORY_DATABASE_POOL_SIZE', '1e2'],
    ['ARKVORY_MAX_REQUESTS', '18'],
    ['ARKVORY_ACCESS_LOG', 'yes'],
    ['ARKVORY_DRAIN_TIMEOUT_MS', '3600001'],
    ['ARKVORY_STORAGE_RESERVE_BYTES', '-1'],
  ])
    assert.throws(() => readOperability({ [name]: value }, transfers), new RegExp(name), name);
  assert.equal(storageReserveBytes(undefined), 1024 ** 3);
  await assert.rejects(
    loadConfig({
      ARKVORY_DATABASE_URL: secret,
      ARKVORY_KEYS_FILE: join(import.meta.dirname, 'missing-keys.json'),
      ARKVORY_DATA_DIR: '.',
    }),
    { message: 'Cannot read ARKVORY_KEYS_FILE (ENOENT)' },
  );
});
