import test from 'node:test';
import assert from 'node:assert/strict';
import {
  captureBusy,
  formatTime,
  jobActive,
  needsPolling,
  nextRun,
  overallState,
  parseTime,
  pollDelay,
  progressPercent,
  timeZones,
  vaultEncryption,
  vaultView,
  verification,
  zoneOffset,
} from '../apps/web/dist/backup-model.js';
import { relativeParts } from '../apps/web/dist/relative-time.js';

// Fixed instants: the rules never read the clock of the machine running the test.
const now = Date.parse('2026-10-02T12:00:00.000Z');
const plan = (enabled) => ({ enabled, hour: 2, minute: 0, timezone: 'UTC', revision: 1 });
const job = (kind, state) => ({ kind, state });

test('the state chip is critical with any critical warning and green only without warnings', () => {
  assert.equal(overallState([]), 'ok');
  assert.equal(overallState([{ code: 'schedule_disabled', severity: 'warning' }]), 'warning');
  assert.equal(
    overallState([
      { code: 'no_backup_yet', severity: 'warning' },
      { code: 'agent_offline', severity: 'critical' },
    ]),
    'critical',
  );
});

test('next run is off, unknown, scheduled or overdue relative to the given instant', () => {
  assert.deepEqual(nextRun({ plan: plan(false), nextRunAt: null }, now), { kind: 'disabled' });
  // A disabled plan never reads as overdue, even with a stale time from the server.
  assert.deepEqual(nextRun({ plan: plan(false), nextRunAt: '2026-10-01T02:00:00.000Z' }, now), {
    kind: 'disabled',
  });
  assert.deepEqual(nextRun({ plan: plan(true), nextRunAt: null }, now), { kind: 'unknown' });
  assert.deepEqual(nextRun({ plan: plan(true), nextRunAt: '2026-10-03T02:00:00.000Z' }, now), {
    kind: 'scheduled',
    at: '2026-10-03T02:00:00.000Z',
  });
  assert.deepEqual(nextRun({ plan: plan(true), nextRunAt: '2026-10-02T02:00:00.000Z' }, now), {
    kind: 'overdue',
    at: '2026-10-02T02:00:00.000Z',
  });
});

test('vault facts are unknown while the agent is offline, unless never configured', () => {
  const status = (configured, online, available) => ({
    vault: { configured, id: null, available, freeBytes: '10', totalBytes: '100' },
    agent: { online, lastSeenAt: null, version: null },
  });
  assert.deepEqual(vaultView(status(false, true, false)), { kind: 'not_configured' });
  assert.deepEqual(vaultView(status(false, false, false)), { kind: 'not_configured' });
  assert.deepEqual(vaultView(status(true, false, true)), { kind: 'unknown' });
  assert.deepEqual(vaultView(status(true, true, false)), { kind: 'unavailable' });
  assert.deepEqual(vaultView(status(true, true, true)), {
    kind: 'available',
    free: '10',
    total: '100',
  });
});

test('encryption is shown only for a configured vault whose flag the agent reported', () => {
  const status = (configured, encrypted) => ({ vault: { configured, encrypted } });
  assert.equal(vaultEncryption(status(true, true)), 'encrypted');
  assert.equal(vaultEncryption(status(true, false)), 'plain');
  assert.equal(vaultEncryption(status(true, null)), 'unknown');
  assert.equal(vaultEncryption(status(false, false)), 'unknown');
});

test('verification shows a failure before the depth of an earlier successful check', () => {
  assert.equal(verification({ verifyDepth: null, verifyError: null }), 'none');
  assert.equal(verification({ verifyDepth: 'structural', verifyError: null }), 'structural');
  assert.equal(verification({ verifyDepth: 'deep', verifyError: null }), 'deep');
  assert.equal(verification({ verifyDepth: 'deep', verifyError: 'manifest_invalid' }), 'failed');
});

test('progress needs a measurable total and stays exact beyond 2^53 bytes', () => {
  const progress = (bytesCopied, bytesTotal) => ({
    bytesCopied,
    bytesTotal,
    blobsCopied: 0,
    blobsTotal: 0,
  });
  assert.equal(progressPercent(progress('0', '0')), null);
  assert.equal(progressPercent(progress('1', '3')), 33.3);
  assert.equal(progressPercent(progress('9007199254740993', '18014398509481986')), 50);
  assert.equal(progressPercent(progress('9007199254740993', '9007199254740993')), 100);
  assert.equal(progressPercent(progress('5', '4')), 100);
});

test('polling runs only for open jobs and backs off to at most a minute', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 10].map(pollDelay), [5000, 10000, 20000, 40000, 60000, 60000]);
  assert.deepEqual(
    ['queued', 'running', 'committing', 'completed', 'failed', 'interrupted'].map(jobActive),
    [true, true, true, false, false, false],
  );
  assert.equal(needsPolling(null, []), false);
  assert.equal(needsPolling({ running: null }, [job('capture', 'completed')]), false);
  assert.equal(needsPolling({ running: null }, [job('retention', 'queued')]), true);
  assert.equal(needsPolling({ running: job('verify', 'running') }, []), true);
  assert.equal(captureBusy(null, [job('verify', 'queued')]), false);
  assert.equal(captureBusy(null, [job('capture', 'failed'), job('capture', 'queued')]), true);
  assert.equal(captureBusy({ running: job('capture', 'committing') }, []), true);
});

test('zone offsets follow daylight saving time and unknown zones stay unknown', () => {
  const winter = Date.parse('2026-01-15T12:00:00.000Z');
  const summer = Date.parse('2026-07-15T12:00:00.000Z');
  assert.equal(zoneOffset('UTC', winter), 'UTC+00:00');
  assert.equal(zoneOffset('Europe/Moscow', winter), 'UTC+03:00');
  assert.equal(zoneOffset('Europe/Moscow', summer), 'UTC+03:00');
  assert.equal(zoneOffset('America/New_York', winter), 'UTC-05:00');
  assert.equal(zoneOffset('America/New_York', summer), 'UTC-04:00');
  assert.equal(zoneOffset('Asia/Kolkata', summer), 'UTC+05:30');
  assert.equal(zoneOffset('Mars/Base', summer), null);
  assert.equal(zoneOffset('', summer), null);
  const zones = timeZones();
  assert.equal(zones[0], 'UTC');
  assert.equal(new Set(zones).size, zones.length);
  assert.ok(zones.includes('Europe/Moscow'));
});

test('the time field round-trips HH:MM and rejects anything else', () => {
  assert.deepEqual(parseTime('03:30'), { hour: 3, minute: 30 });
  assert.deepEqual(parseTime('23:59'), { hour: 23, minute: 59 });
  for (const invalid of ['', '3:30', '24:00', '12:60', '12:30:00'])
    assert.equal(parseTime(invalid), null, invalid);
  assert.equal(formatTime(3, 5), '03:05');
  assert.equal(formatTime(23, 59), '23:59');
});

test('relative age uses hours up to two days and never formats negative zero', () => {
  assert.deepEqual(relativeParts(now - 30_000, now), { value: -30, unit: 'second' });
  const zero = relativeParts(now - 400, now);
  assert.equal(Object.is(zero.value, -0), false);
  assert.deepEqual(zero, { value: 0, unit: 'second' });
  assert.deepEqual(relativeParts(now - 59 * 60_000 - 59_000, now), { value: -59, unit: 'minute' });
  assert.deepEqual(relativeParts(now - 26 * 3_600_000, now), { value: -26, unit: 'hour' });
  assert.deepEqual(relativeParts(now - 47 * 3_600_000, now), { value: -47, unit: 'hour' });
  assert.deepEqual(relativeParts(now - 3 * 86_400_000, now), { value: -3, unit: 'day' });
  assert.deepEqual(relativeParts(now + 120_000, now), { value: 2, unit: 'minute' });
});
