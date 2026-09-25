import test from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { defaultStoragePolicy, parseStoragePolicy, capacityState } from '@proanima/depot-domain';
import { readStoragePolicy, readStorageUsage, readStorageEvents } from '@proanima/depot-contracts';
import { DiagnosticLogger } from '@proanima/depot-infrastructure';

test('policy validation bounds quotas and rejects ambiguity; capacity thresholds use exact integers', () => {
  const base = defaultStoragePolicy();
  assert.deepEqual(readStoragePolicy(base), parseStoragePolicy(base));
  for (const bad of [
    { keepLast: 0 },
    { keepLast: 1.5 },
    { minAgeHours: -1 },
    {
      channels: [
        { label: 'test', keepLast: 1 },
        { label: 'test', keepLast: 2 },
      ],
    },
    { quotaBytes: '01' },
    { quotaBytes: '9007199254740992' },
    { warningPercent: 95, criticalPercent: 90 },
    { enabled: 'false' },
  ]) {
    assert.throws(() => parseStoragePolicy({ ...base, ...bad }));
    assert.throws(() => readStoragePolicy({ ...base, ...bad }));
  }
  assert.throws(() => parseStoragePolicy({ ...base, unexpected: true }));
  const policy = { ...base, quotaBytes: '9007199254740991' };
  assert.equal(capacityState('9007199254740991', policy), 'exceeded');
  assert.equal(capacityState('9007199254740990', policy), 'critical');
  assert.equal(capacityState('7205759403792792', policy), 'normal');
  assert.equal(capacityState('7205759403792794', policy), 'warning');
  assert.throws(() =>
    readStorageUsage({
      publishedBytes: '1',
      pendingBytes: '1',
      retiredBytes: '1',
      reservedBytes: '2',
      quotaBytes: null,
      state: 'unlimited',
    }),
  );
  assert.throws(() => readStorageEvents({ items: [], next: '1' }));
});

test('structured diagnostics stop buffering under backpressure and report dropped events on recovery', async () => {
  const lines = [],
    callbacks = [];
  const sink = new Writable({
    highWaterMark: 1,
    write(chunk, _encoding, done) {
      lines.push(String(chunk));
      callbacks.push(done);
    },
  });
  const logger = new DiagnosticLogger(sink, () => '2026-01-01T00:00:00.000Z');
  logger.write({
    level: 'error',
    component: 'api',
    code: 'unavailable',
    requestId: 'safe-id',
    route: '/api/v1/repositories/:repository/uploads/:id',
  });
  for (let i = 0; i < 10000; i++)
    logger.write({ level: 'warning', component: 'api', code: 'busy' });
  assert.equal(lines.length, 1);
  assert.ok(sink.writableLength < 2048);
  callbacks.shift()();
  await new Promise((r) => setImmediate(r));
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[1]).code, 'diagnostics.dropped.10000');
  callbacks.shift()();
  await new Promise((r) => setImmediate(r));
  logger.close();
  sink.end();
});
