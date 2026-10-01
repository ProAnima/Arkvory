import test from 'node:test';
import assert from 'node:assert/strict';
import { AdmissionQueue, MetricsRegistry, processIdentity } from '@proanima/arkvory-infrastructure';
import { createHttpServer } from '../apps/api/dist/http-server.js';
import {
  ApiMetrics,
  metricsContentType,
  registerMetrics,
  statusClass,
} from '../apps/api/dist/api-metrics.js';

/** Minimal text-format 0.0.4 parser: every sample line is name{labels} value. */
function samples(text) {
  const lines = text.trimEnd().split('\n');
  const types = new Map();
  const result = [];
  for (const line of lines) {
    if (line.startsWith('# TYPE ')) {
      const [, , name, type] = line.split(' ');
      types.set(name, type);
      continue;
    }
    if (line.startsWith('# HELP ')) continue;
    const match = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{(.*)\})? (\S+)$/.exec(line);
    assert.ok(match, `malformed sample line: ${line}`);
    const labels = {};
    for (const pair of (match[3] ?? '').matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g))
      labels[pair[1]] = pair[2];
    result.push({ name: match[1], labels, value: Number(match[4]) });
  }
  return { types, result };
}

test('registry renders counters, cumulative histograms and sampled metrics in text format', () => {
  const registry = new MetricsRegistry(3);
  const counter = registry.counter('demo_total', 'Demo\ncounter', ['route']);
  counter.inc({ route: '/a' });
  counter.inc({ route: '/a' }, 2);
  counter.inc({ route: 'quote"back\\slash\nline' });
  counter.inc({ route: '/ignored' }, -1);
  const histogram = registry.histogram('demo_seconds', 'Demo histogram', ['route'], [0.1, 1]);
  histogram.observe({ route: '/a' }, 0.05);
  histogram.observe({ route: '/a' }, 0.5);
  histogram.observe({ route: '/a' }, 7);
  registry.sampled({
    name: 'demo_queue',
    help: 'Sampled',
    type: 'gauge',
    labels: ['direction'],
    collect: () => [{ labels: { direction: 'upload' }, value: 4 }],
  });
  registry.sampled({
    name: 'demo_broken',
    help: 'A failing collector omits only its own samples',
    type: 'counter',
    labels: [],
    collect: () => {
      throw new Error('collector down');
    },
  });
  const text = registry.render();
  assert.ok(text.endsWith('\n'));
  assert.match(text, /# HELP demo_total Demo\\ncounter\n# TYPE demo_total counter\n/);
  assert.match(text, /demo_total\{route="quote\\"back\\\\slash\\nline"\} 1\n/);
  const { types, result } = samples(text);
  assert.equal(types.get('demo_seconds'), 'histogram');
  assert.equal(types.get('demo_broken'), 'counter');
  const value = (name, labels) =>
    result.find(
      (s) => s.name === name && Object.entries(labels).every(([k, v]) => s.labels[k] === v),
    )?.value;
  assert.equal(value('demo_total', { route: '/a' }), 3);
  assert.equal(value('demo_seconds_bucket', { route: '/a', le: '0.1' }), 1);
  assert.equal(value('demo_seconds_bucket', { route: '/a', le: '1' }), 2);
  assert.equal(value('demo_seconds_bucket', { route: '/a', le: '+Inf' }), 3);
  assert.equal(value('demo_seconds_count', { route: '/a' }), 3);
  assert.equal(value('demo_seconds_sum', { route: '/a' }), 7.55);
  assert.equal(value('demo_queue', { direction: 'upload' }), 4);
  assert.equal(result.filter((s) => s.name === 'demo_broken').length, 0);
  assert.throws(() => registry.counter('demo_total', 'duplicate'), /Invalid metric/);
  assert.throws(() => registry.counter('bad-name', 'x'), /Invalid metric/);
  assert.throws(() => registry.counter('ok_total', 'x', ['__reserved']), /Invalid label/);
  assert.throws(() => registry.histogram('h', 'x', [], [1, 1]), /strictly increasing/);
  assert.throws(() => registry.histogram('h2', 'x', ['le'], [1]), /reserved/);
});

test('series cap folds new label sets into one "other" series and counts the overflow', () => {
  const registry = new MetricsRegistry(4);
  const counter = registry.counter('capped_total', 'Capped', ['route']);
  for (let i = 0; i < 100; i++) counter.inc({ route: `/raw/${String(i)}` });
  const { result } = samples(registry.render());
  const series = result.filter((s) => s.name === 'capped_total');
  assert.equal(series.length, 5, 'four real series plus one overflow series');
  assert.equal(series.find((s) => s.labels.route === 'other')?.value, 96);
  assert.equal(
    result.find(
      (s) =>
        s.name === 'arkvory_metrics_series_overflow_total' && s.labels.metric === 'capped_total',
    )?.value,
    96,
  );
});

async function instrumented(t) {
  const app = createHttpServer();
  const uploadGate = new AdmissionQueue(1, 4, 4, 1000, 1);
  const downloadGate = new AdmissionQueue(2, 4, 4, 1000, 2);
  let clock = 0;
  const metrics = new ApiMetrics({
    identity: processIdentity('api', '9.8.7', 1, 'metrics-host'),
    transfers: { uploadGate, downloadGate },
    activeRequests: () => 3,
    diagnostics: { counters: { written: 10, dropped: 2, truncated: 1, oversized: 0 } },
    jobs: { backlog: async () => ({ queued: 5, running: 1, oldestQueuedSeconds: 12.5 }) },
    now: () => (clock += 20),
    startedAtSeconds: 1700000000,
    residentMemory: () => 123456,
  });
  registerMetrics(app, metrics, () => (clock += 20));
  app.get('/items/:id', async () => ({ ok: true }));
  app.post('/items/:id', async (_request, reply) => reply.code(503).send({ code: 'busy' }));
  t.after(() => app.close());
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  return { app, address, uploadGate };
}

test('HTTP metrics label route templates, methods and status classes, never raw URLs', async (t) => {
  const { address } = await instrumented(t);
  for (let i = 0; i < 40; i++) await (await fetch(`${address}/items/${String(i)}?q=secret`)).text();
  await (await fetch(`${address}/items/1`, { method: 'POST' })).text();
  await (await fetch(`${address}/missing/path-${String(Date.now())}`)).text();
  const response = await fetch(`${address}/health/metrics`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), metricsContentType);
  const text = await response.text();
  assert.doesNotMatch(text, /\/items\/\d|secret|path-\d/);
  const { types, result } = samples(text);
  const find = (name, labels) =>
    result.find(
      (s) => s.name === name && Object.entries(labels).every(([k, v]) => s.labels[k] === v),
    );
  assert.equal(types.get('arkvory_http_requests_total'), 'counter');
  assert.equal(
    find('arkvory_http_requests_total', { method: 'GET', route: '/items/:id', status_class: '2xx' })
      ?.value,
    40,
  );
  assert.equal(
    find('arkvory_http_requests_total', {
      method: 'POST',
      route: '/items/:id',
      status_class: '5xx',
    })?.value,
    1,
  );
  assert.equal(
    find('arkvory_http_requests_total', { route: 'unmatched', status_class: '4xx' })?.value,
    1,
  );
  const routes = new Set(
    result.filter((s) => s.name === 'arkvory_http_requests_total').map((s) => s.labels.route),
  );
  assert.deepEqual([...routes].sort(), ['/items/:id', 'unmatched']);
  assert.equal(
    find('arkvory_http_request_duration_seconds_bucket', {
      method: 'GET',
      route: '/items/:id',
      le: '+Inf',
    })?.value,
    40,
  );
  assert.ok(find('arkvory_http_response_bytes_total', { route: '/items/:id' })?.value > 0);
  assert.ok(find('arkvory_http_request_bytes_total', { route: '/items/:id' })?.value > 0);
  assert.equal(find('arkvory_build_info', { service: 'api', version: '9.8.7' })?.value, 1);
  assert.equal(find('arkvory_http_requests_in_flight', {})?.value, 3);
  assert.equal(find('arkvory_completion_jobs', { state: 'queued' })?.value, 5);
  assert.equal(find('arkvory_completion_oldest_queued_seconds', {})?.value, 12.5);
  assert.equal(find('arkvory_diagnostic_records_total', { outcome: 'dropped' })?.value, 2);
  assert.equal(find('arkvory_transfer_queue_depth', { direction: 'download' })?.value, 0);
});

test('transfer gauges follow admission state and the label set stays bounded', async (t) => {
  const { address, uploadGate } = await instrumented(t);
  const release = await uploadGate.acquire('a');
  const waiting = uploadGate.acquire('b');
  const scrape = async () => samples(await (await fetch(`${address}/health/metrics`)).text());
  let { result } = await scrape();
  const value = (rows, name, labels) =>
    rows.find((s) => s.name === name && Object.entries(labels).every(([k, v]) => s.labels[k] === v))
      ?.value;
  assert.equal(value(result, 'arkvory_transfer_active', { direction: 'upload' }), 1);
  assert.equal(value(result, 'arkvory_transfer_queue_depth', { direction: 'upload' }), 1);
  release();
  (await waiting)();
  ({ result } = await scrape());
  assert.equal(value(result, 'arkvory_transfer_queue_depth', { direction: 'upload' }), 0);
  assert.equal(
    value(result, 'arkvory_transfer_admission_failures_total', {
      direction: 'upload',
      reason: 'rejected',
    }),
    0,
  );
  // The complete label vocabulary: no identifiers of artifacts, keys, principals or requests.
  const allowed = new Set([
    'collector',
    'direction',
    'le',
    'method',
    'metric',
    'outcome',
    'reason',
    'route',
    'service',
    'state',
    'status_class',
    'version',
  ]);
  for (const name of new Set(result.flatMap((s) => Object.keys(s.labels))))
    assert.ok(allowed.has(name), name);
  assert.deepEqual([100, 204, 304, 404, 503, 99, 600].map(statusClass), [
    '1xx',
    '2xx',
    '3xx',
    '4xx',
    '5xx',
    'other',
    'other',
  ]);
});
