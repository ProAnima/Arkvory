import test from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  DiagnosticLogger,
  MAX_DIAGNOSTIC_LINE,
  PostgresJobLease,
  parseLogLevel,
  processIdentity,
  readReleaseVersion,
} from '@proanima/arkvory-infrastructure';
import { createHttpServer } from '../apps/api/dist/http-server.js';
import {
  requestIdGenerator,
  traceIdOf,
  trustedPeerMatcher,
} from '../apps/api/dist/request-correlation.js';
import { RequestDrain } from '../apps/api/dist/drain.js';
import { createShutdown } from '../apps/api/dist/shutdown.js';
import { removeTestDirectory } from './helpers.mjs';

function capture() {
  const lines = [];
  const sink = new Writable({
    write(chunk, _encoding, done) {
      lines.push(String(chunk));
      done();
    },
  });
  return { sink, records: () => lines.filter((l) => l.trim()).map((l) => JSON.parse(l)), lines };
}
const identity = processIdentity('api', '1.4.2', 4242, 'node-a.example');

test('level filter discards lower records before they are serialized', () => {
  const { sink, records } = capture();
  let clock = 0;
  const logger = new DiagnosticLogger(sink, () => `t${String(++clock)}`, {
    level: 'warning',
    process: identity,
  });
  logger.write({ level: 'debug', component: 'worker', code: 'completion.started' });
  logger.write({ level: 'info', component: 'http', code: 'http.access' });
  assert.equal(clock, 0, 'filtered records never reached the clock or JSON serialization');
  logger.write({ level: 'warning', component: 'http', code: 'busy' });
  logger.write({ level: 'error', component: 'process', code: 'startup.failed' });
  assert.deepEqual(
    records().map((r) => r.code),
    ['busy', 'startup.failed'],
  );
  assert.equal(logger.enabled('info'), false);
  assert.equal(logger.enabled('error'), true);
  assert.equal(parseLogLevel(undefined), 'info');
  assert.equal(parseLogLevel('debug'), 'debug');
  for (const invalid of ['warn', 'INFO', 'trace', ' error'])
    assert.throws(() => parseLogLevel(invalid), /Invalid ARKVORY_LOG_LEVEL/);
  logger.close();
});

test('every line carries bounded process fields in a stable order', async (t) => {
  const { sink, lines } = capture();
  const logger = new DiagnosticLogger(sink, () => '2026-10-01T00:00:00.000Z', {
    process: identity,
  });
  logger.write({ level: 'info', component: 'process', code: 'api.listening', port: 8080 });
  const record = JSON.parse(lines[0]);
  assert.deepEqual(Object.keys(record).slice(0, 8), [
    'timestamp',
    'level',
    'service',
    'version',
    'pid',
    'hostname',
    'component',
    'code',
  ]);
  assert.deepEqual(
    [record.service, record.version, record.pid, record.hostname],
    ['api', '1.4.2', 4242, 'node-a.example'],
  );
  const hostile = processIdentity(
    'worker',
    '1.0.0\n{"x":1}',
    -1,
    'host name\r\n' + 'h'.repeat(300),
  );
  assert.equal(hostile.version, 'dev');
  assert.equal(hostile.pid, 0);
  assert.match(hostile.hostname, /^[A-Za-z0-9._-]{1,64}$/);
  const directory = await mkdtemp(join(tmpdir(), 'arkvory-release-'));
  t.after(() => removeTestDirectory(directory));
  const manifest = join(directory, 'release.json');
  assert.equal(await readReleaseVersion(pathToFileURL(manifest)), 'dev', 'missing manifest');
  await writeFile(manifest, JSON.stringify({ format: 1, version: '2.3.4', commit: 'abc' }));
  assert.equal(await readReleaseVersion(pathToFileURL(manifest)), '2.3.4');
  await writeFile(manifest, JSON.stringify({ version: '../../etc' }));
  assert.equal(await readReleaseVersion(pathToFileURL(manifest)), 'dev');
  await writeFile(manifest, '{not json');
  assert.equal(await readReleaseVersion(pathToFileURL(manifest)), 'dev');
  logger.close();
});

test('long fields are clipped and counted; an oversized record becomes a bounded notice', () => {
  const { sink, lines, records } = capture();
  const logger = new DiagnosticLogger(sink, () => '2026-10-01T00:00:00.000Z', {
    process: identity,
  });
  logger.write({
    level: 'error',
    component: 'process',
    code: 'startup.failed',
    reason: 'r'.repeat(1000),
    route: '/x'.repeat(400),
  });
  const clipped = records()[0];
  assert.equal(clipped.reason.length, 241);
  assert.ok(clipped.reason.endsWith('…'));
  assert.equal(clipped.route.length, 257);
  assert.equal(clipped.truncated, 2);
  // Escaped control characters expand six-fold, so clipping alone cannot bound this line.
  const control = '\u0001'.repeat(256);
  logger.write({
    level: 'info',
    component: 'http',
    code: 'http.access',
    requestId: 'req-0123456789',
    route: control,
    principal: control,
    clientIp: control,
    method: control,
  });
  const notice = records()[1];
  assert.equal(notice.code, 'diagnostics.oversized');
  assert.equal(notice.recordCode, 'http.access');
  assert.equal(notice.requestId, 'req-0123456789');
  assert.equal(notice.service, 'api');
  assert.ok(lines.every((line) => line.length <= MAX_DIAGNOSTIC_LINE + 1));
  // truncated counts records with at least one clipped field, oversized the replaced records.
  assert.deepEqual(logger.counters, { written: 2, dropped: 0, truncated: 1, oversized: 1 });
  logger.close();
});

test('dropped records are counted and reported once as a numeric field', async () => {
  const lines = [];
  const callbacks = [];
  const sink = new Writable({
    highWaterMark: 1,
    write(chunk, _encoding, done) {
      lines.push(String(chunk));
      callbacks.push(done);
    },
  });
  const logger = new DiagnosticLogger(sink, () => 'now', { level: 'error', process: identity });
  logger.write({ level: 'error', component: 'http', code: 'internal' });
  for (let i = 0; i < 25; i++) logger.write({ level: 'error', component: 'http', code: 'busy' });
  callbacks.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  const notice = JSON.parse(lines[1]);
  // Accounting bypasses the level filter: an error-only logger still reports its losses.
  assert.deepEqual(
    [notice.code, notice.level, notice.dropped],
    ['diagnostics.dropped', 'warning', 25],
  );
  assert.equal(notice.component, 'diagnostics');
  callbacks.shift()();
  await logger.flush(100);
  logger.close();
});

test('inbound X-Request-Id is accepted only from trusted proxies and only when well formed', () => {
  let generated = 0;
  const next = () => `generated-${String(++generated)}`;
  const id = requestIdGenerator(['10.0.0.0/8', '192.0.2.7', '2001:db8::/32'], next);
  const request = (remoteAddress, value) => ({
    headers: value === undefined ? {} : { 'x-request-id': value },
    socket: { remoteAddress },
  });
  assert.equal(id(request('10.1.2.3', 'edge-1234abcd')), 'edge-1234abcd');
  assert.equal(id(request('::ffff:10.1.2.3', 'edge-1234abcd')), 'edge-1234abcd');
  assert.equal(id(request('192.0.2.7', 'f81d4fae-7dec-11d0-a765-00a0c91e6bf6')).length, 36);
  assert.equal(id(request('2001:db8::1', 'Root.1-abc:def_9')), 'Root.1-abc:def_9');
  for (const [peer, value] of [
    ['198.51.100.1', 'edge-1234abcd'], // untrusted peer
    ['192.0.2.8', 'edge-1234abcd'], // neighbour of an exact entry
    [undefined, 'edge-1234abcd'],
    ['10.1.2.3', 'short'],
    ['10.1.2.3', 'x'.repeat(129)],
    ['10.1.2.3', 'two words here'],
    ['10.1.2.3', 'line\nbreak-123'],
    ['10.1.2.3', '-leading-dash'],
    ['10.1.2.3', 'quote"inside1'],
    ['10.1.2.3', ['edge-1234abcd', 'edge-1234abce']],
    ['10.1.2.3', undefined],
  ])
    assert.match(id(request(peer, value)), /^generated-\d+$/, `${String(peer)} ${String(value)}`);
  assert.equal(requestIdGenerator([])(request('127.0.0.1', 'edge-1234abcd')).length, 36);
  assert.throws(() => trustedPeerMatcher(['proxy.internal']), /Invalid trusted proxy/);
});

test('HTTP server echoes a trusted request ID and replaces an untrusted one', async (t) => {
  const app = createHttpServer({ trustedProxies: ['203.0.113.10'] });
  app.get('/id', async (request) => ({ id: request.id }));
  t.after(() => app.close());
  const headers = { 'x-request-id': 'lb-req-000000042' };
  const trusted = await app.inject({ url: '/id', headers, remoteAddress: '203.0.113.10' });
  assert.equal(trusted.json().id, 'lb-req-000000042');
  const direct = await app.inject({ url: '/id', headers, remoteAddress: '203.0.113.11' });
  assert.notEqual(direct.json().id, 'lb-req-000000042');
  assert.match(direct.json().id, /^[0-9a-f-]{36}$/);
});

test('traceparent yields a trace ID only for a strictly valid W3C header', () => {
  const trace = '4bf92f3577b34da6a3ce929d0e0e4736';
  const valid = `00-${trace}-00f067aa0ba902b7-01`;
  assert.equal(traceIdOf(valid), trace);
  assert.equal(traceIdOf(`01-${trace}-00f067aa0ba902b7-01-future-field`), trace);
  for (const invalid of [
    valid.toUpperCase(),
    `ff-${trace}-00f067aa0ba902b7-01`,
    `00-${'0'.repeat(32)}-00f067aa0ba902b7-01`,
    `00-${trace}-${'0'.repeat(16)}-01`,
    `${valid}-extra`,
    `00-${trace}-00f067aa0ba902b7`,
    `00-${trace.slice(1)}-00f067aa0ba902b7-01`,
    ` ${valid}`,
    `01-${trace}-00f067aa0ba902b7-01-${'x'.repeat(600)}`,
    [valid, valid],
    undefined,
    42,
  ])
    assert.equal(traceIdOf(invalid), undefined, String(invalid));
});

test('heartbeat renewal failure is reported to the observer and stops the lease', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100000 });
  let calls = 0;
  const failures = [];
  const lease = new PostgresJobLease(
    {
      heartbeat: async () => {
        if (++calls > 1) throw Object.assign(new Error('terminated'), { code: 'ECONNRESET' });
        return true;
      },
      finish: async () => true,
    },
    'job',
    3,
    () => true,
    (error) => {
      failures.push(error.code);
      throw new Error('observer failures are contained');
    },
  );
  await lease.start();
  t.mock.timers.tick(2000);
  await lease.close();
  assert.deepEqual(failures, ['ECONNRESET']);
  assert.equal(lease.active, false);
  assert.equal(await lease.finish(null), false, 'a lost lease never records the outcome');
});

test('graceful stop logs drain start, settle or timeout, expedite and stop with durations', async () => {
  const records = [];
  const diagnostics = { write: (r) => records.push(r), flush: async () => undefined };
  let clock = 0;
  const closed = [];
  const exits = [];
  const quick = createShutdown({
    app: { close: async () => closed.push('quick') },
    drain: new RequestDrain(),
    drainTimeoutMs: 1000,
    closeBudgetMs: 60000,
    diagnostics,
    now: () => (clock += 5),
    exit: (code) => exits.push(code),
  });
  quick({ signal: 'SIGTERM' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(
    records.map((r) => [r.code, r.durationMs ?? r.drainWindowMs]),
    [
      ['drain.started', 1000],
      ['drain.settled', 5],
      ['api.stopped', 10],
    ],
  );
  assert.equal(records[0].signal, 'SIGTERM');
  records.length = 0;
  const drain = new RequestDrain();
  drain.track({ once: () => undefined });
  const slow = createShutdown({
    app: { close: async () => closed.push('slow') },
    drain,
    drainTimeoutMs: 60000,
    closeBudgetMs: 60000,
    diagnostics,
    now: () => (clock += 5),
    exit: (code) => exits.push(code),
  });
  slow({ signal: 'SIGTERM' });
  slow({ signal: 'SIGINT' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(
    records.map((r) => r.code),
    ['drain.started', 'drain.expedited', 'drain.timeout', 'api.stopped'],
  );
  assert.equal(records[2].activeRequests, 1);
  assert.deepEqual(closed, ['quick', 'slow']);
  assert.deepEqual(exits, []);
});
