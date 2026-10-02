import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ZoneClock,
  calendarBuckets,
  scheduleDecision,
  slotAfter,
  slotAtOrBefore,
  upcomingSlots,
  validTimeZone,
} from '@proanima/arkvory-domain';

const at = (iso) => Date.parse(iso);
const iso = (ms) => new Date(ms).toISOString();
const daily = (hour, minute, timezone, enabled = true) => ({ enabled, hour, minute, timezone });

test('time zones are explicit IANA names validated by Intl', () => {
  for (const zone of ['UTC', 'Europe/Moscow', 'America/New_York', 'Etc/GMT+3', 'Asia/Kolkata'])
    assert.equal(validTimeZone(zone), true, zone);
  for (const zone of [
    '',
    'Mars/Base',
    '+03:00',
    'local',
    '../etc',
    'Europe/Moscow ',
    'A'.repeat(65),
  ])
    assert.equal(validTimeZone(zone), false, zone);
  assert.throws(() => new ZoneClock('Mars/Base'), RangeError);
});

test('a daily slot is the local wall time of the plan zone, not of the host', () => {
  // Moscow has no DST: 02:00 MSK is always 23:00 UTC of the previous day.
  const moscow = daily(2, 0, 'Europe/Moscow');
  assert.equal(iso(slotAfter(moscow, at('2026-10-02T10:00:00Z'))), '2026-10-02T23:00:00.000Z');
  assert.equal(iso(slotAfter(moscow, at('2026-10-02T23:00:00Z'))), '2026-10-03T23:00:00.000Z');
  assert.equal(iso(slotAtOrBefore(moscow, at('2026-10-02T22:59:59Z'))), '2026-10-01T23:00:00.000Z');
  assert.deepEqual(upcomingSlots(moscow, at('2026-03-28T00:00:00Z'), 3).map(iso), [
    '2026-03-28T23:00:00.000Z',
    '2026-03-29T23:00:00.000Z',
    '2026-03-30T23:00:00.000Z',
  ]);
  assert.deepEqual(upcomingSlots(moscow, 0, 0), []);
});

test('a nonexistent local time runs at the first valid instant after it (New York gap)', () => {
  // 2026-03-08 02:00 EST jumps to 03:00 EDT at 07:00 UTC; 02:30 does not exist that night.
  const plan = daily(2, 30, 'America/New_York');
  const gap = slotAfter(plan, at('2026-03-07T12:00:00Z'));
  assert.equal(iso(gap), '2026-03-08T07:00:00.000Z');
  assert.equal(iso(slotAfter(plan, gap)), '2026-03-09T06:30:00.000Z');
  assert.equal(iso(slotAfter(plan, at('2026-03-06T12:00:00Z'))), '2026-03-07T07:30:00.000Z');
});

test('an ambiguous local time runs once, at its first occurrence (New York overlap)', () => {
  // 2026-11-01 01:00-02:00 happens twice: first EDT (05:00-06:00 UTC), then EST.
  const plan = daily(1, 30, 'America/New_York');
  const first = slotAfter(plan, at('2026-10-31T12:00:00Z'));
  assert.equal(iso(first), '2026-11-01T05:30:00.000Z');
  // After the first occurrence the next slot is the following day, never the repeated hour.
  assert.equal(iso(slotAfter(plan, first)), '2026-11-02T06:30:00.000Z');
  assert.equal(iso(slotAfter(plan, at('2026-11-01T06:00:00Z'))), '2026-11-02T06:30:00.000Z');
  const decision = scheduleDecision(
    plan,
    { lastSlotAt: first, scheduleFrom: 0 },
    at('2026-11-01T06:45:00Z'),
  );
  assert.deepEqual(decision, { nextRunAt: at('2026-11-02T06:30:00Z'), due: null });
});

test('downtime yields exactly one catch-up run and nextRunAt follows the last slot', () => {
  const plan = daily(2, 0, 'UTC');
  const last = at('2026-10-01T02:00:00Z');
  // Down for four days: one due slot, the latest one, not a queue of missed days.
  const late = scheduleDecision(
    plan,
    { lastSlotAt: last, scheduleFrom: 0 },
    at('2026-10-05T03:00:00Z'),
  );
  assert.deepEqual(late, {
    nextRunAt: at('2026-10-02T02:00:00Z'),
    due: at('2026-10-05T02:00:00Z'),
  });
  const after = scheduleDecision(
    plan,
    { lastSlotAt: late.due, scheduleFrom: 0 },
    at('2026-10-05T09:00:00Z'),
  );
  assert.deepEqual(after, { nextRunAt: at('2026-10-06T02:00:00Z'), due: null });
  // A long capture does not move the plan: the next slot counts from the slot, not the end.
  const longJob = scheduleDecision(
    plan,
    { lastSlotAt: at('2026-10-06T02:00:00Z'), scheduleFrom: 0 },
    at('2026-10-07T01:59:00Z'),
  );
  assert.equal(iso(longJob.nextRunAt), '2026-10-07T02:00:00.000Z');
  assert.equal(longJob.due, null);
});

test('slots before the schedule changed are never caught up; a disabled plan never runs', () => {
  const plan = daily(2, 0, 'UTC');
  const changed = at('2026-10-05T10:00:00Z');
  assert.deepEqual(
    scheduleDecision(
      plan,
      { lastSlotAt: at('2026-10-01T02:00:00Z'), scheduleFrom: changed },
      at('2026-10-05T11:00:00Z'),
    ),
    { nextRunAt: at('2026-10-06T02:00:00Z'), due: null },
  );
  assert.deepEqual(
    scheduleDecision(plan, { lastSlotAt: null, scheduleFrom: changed }, at('2026-10-06T02:00:01Z')),
    { nextRunAt: at('2026-10-06T02:00:00Z'), due: at('2026-10-06T02:00:00Z') },
  );
  assert.deepEqual(
    scheduleDecision({ ...plan, enabled: false }, { lastSlotAt: null, scheduleFrom: 0 }, changed),
    { nextRunAt: null, due: null },
  );
  assert.throws(() => slotAfter(plan, Number.NaN), RangeError);
});

test('calendar buckets use the plan zone and ISO 8601 weeks', () => {
  const moscow = new ZoneClock('Europe/Moscow');
  // 22:00 UTC on New Year's Eve is already 1 January in Moscow, still ISO week 2026-W53.
  assert.deepEqual(calendarBuckets(moscow, at('2026-12-31T22:00:00Z')), {
    day: '2027-01-01',
    week: '2026-W53',
    month: '2027-01',
  });
  const utc = new ZoneClock('UTC');
  assert.deepEqual(calendarBuckets(utc, at('2021-01-03T10:00:00Z')).week, '2020-W53');
  assert.deepEqual(calendarBuckets(utc, at('2024-12-30T10:00:00Z')).week, '2025-W01');
  assert.deepEqual(calendarBuckets(utc, at('2026-10-02T10:00:00Z')), {
    day: '2026-10-02',
    week: '2026-W40',
    month: '2026-10',
  });
});
