import test from 'node:test';
import assert from 'node:assert/strict';
import { BandwidthGovernor } from '@proanima/depot-infrastructure';

function virtualClock() {
  let now = 0,
    id = 0;
  const timers = new Map();
  return {
    now: () => now,
    schedule(action, ms) {
      const key = ++id;
      timers.set(key, { at: now + ms, action });
      return () => timers.delete(key);
    },
    advance(ms) {
      const target = now + ms;
      for (;;) {
        const first = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!first || first[1].at > target) break;
        now = first[1].at;
        timers.delete(first[0]);
        first[1].action();
      }
      now = target;
    },
    get pending() {
      return timers.size;
    },
  };
}

test('registered account principal receives the same bounded quota as a configured key', async () => {
  const gate = new BandwidthGovernor(
    { bytesPerSecond: 131072, perPrincipalBytesPerSecond: 65536 },
    ['service'],
  );
  await assert.rejects(gate.acquire('user:alice', 1), { code: 'forbidden' });
  gate.register('user:alice');
  gate.register('user:alice');
  await gate.acquire('user:alice', 1);
  gate.close();
});

test('bandwidth shares aggregate and principal budgets across concurrent flows with bounded burst', async () => {
  const time = virtualClock();
  const gate = new BandwidthGovernor(
    { bytesPerSecond: 131072, perPrincipalBytesPerSecond: 65536 },
    ['a', 'b'],
    () => true,
    time,
  );
  const granted = { a: 0, b: 0 },
    pending = [];
  for (let n = 0; n < 30; n++)
    for (const owner of ['a', 'b']) {
      pending.push(
        gate.acquire(owner, gate.quantum).then(() => {
          granted[owner] += gate.quantum;
        }),
      );
    }
  for (let n = 0; n <= 30; n++) {
    await Promise.resolve();
    assert(granted.a <= Math.floor(65536 / 10) + (time.now() * 65536) / 1000);
    assert(granted.b <= Math.floor(65536 / 10) + (time.now() * 65536) / 1000);
    assert(granted.a + granted.b <= Math.floor(131072 / 10) + (time.now() * 131072) / 1000);
    time.advance(100);
  }
  await Promise.all(pending);
  assert.equal(granted.a, 30 * gate.quantum);
  assert.equal(gate.snapshot.waiting, 0);
  assert.equal(time.pending, 0);
});

test('a principal with many connections cannot jump the byte round-robin', async () => {
  const time = virtualClock(),
    order = [];
  const gate = new BandwidthGovernor(
    { bytesPerSecond: 65536, perPrincipalBytesPerSecond: 0 },
    ['a', 'b', 'c'],
    () => true,
    time,
  );
  await gate.acquire('a', gate.quantum);
  const pending = Array.from({ length: 5 }, () =>
    gate.acquire('a', gate.quantum).then(() => order.push('a')),
  );
  pending.push(gate.acquire('b', gate.quantum).then(() => order.push('b')));
  pending.push(gate.acquire('c', gate.quantum).then(() => order.push('c')));
  for (let n = 0; n < 8; n++) {
    await Promise.resolve();
    time.advance(100);
  }
  await Promise.all(pending);
  assert.deepEqual(order.slice(0, 3), ['a', 'b', 'c']);
});

test('reconnecting does not refill principal quota, while other principals can use spare bandwidth', async () => {
  const time = virtualClock();
  const gate = new BandwidthGovernor(
    { bytesPerSecond: 0, perPrincipalBytesPerSecond: 65536 },
    ['same-id', 'other'],
    () => true,
    time,
  );
  await gate.acquire('same-id', gate.quantum);
  let granted = false;
  const nextConnection = gate.acquire('same-id', gate.quantum).then(() => {
    granted = true;
  });
  await gate.acquire('other', gate.quantum);
  assert.equal(granted, false);
  time.advance(100);
  await nextConnection;
  assert.equal(granted, true);
});

test('abort, queue bound, ownership loss and close release timers and reject pending work', async () => {
  const time = virtualClock();
  let active = true;
  const gate = new BandwidthGovernor(
    { bytesPerSecond: 65536, perPrincipalBytesPerSecond: 0 },
    ['a'],
    () => active,
    time,
  );
  await gate.acquire('a', gate.quantum);
  const stop = new AbortController();
  const cancelled = gate.acquire('a', gate.quantum, stop.signal);
  stop.abort();
  await assert.rejects(cancelled, { code: 'busy' });
  assert.equal(gate.snapshot.waiting, 0);
  assert.equal(time.pending, 0);
  const waiters = Array.from({ length: 256 }, () => gate.acquire('a', gate.quantum));
  await assert.rejects(gate.acquire('a', gate.quantum), { code: 'busy' });
  const results = Promise.allSettled(waiters);
  active = false;
  time.advance(100);
  assert(
    (await results).every(
      (result) => result.status === 'rejected' && result.reason.code === 'unavailable',
    ),
  );
  await assert.rejects(gate.acquire('a', 1), { code: 'unavailable' });
  assert.equal(time.pending, 0);
});

test('stream obeys backpressure, preserves bytes and returns its source on cancellation', async () => {
  const time = virtualClock();
  const gate = new BandwidthGovernor(
    { bytesPerSecond: 65536, perPrincipalBytesPerSecond: 0 },
    ['a'],
    () => true,
    time,
  );
  let pulled = 0,
    returned = false;
  async function* source() {
    try {
      for (let n = 0; n < 3; n++) {
        pulled++;
        yield Buffer.alloc(65536, n);
      }
    } finally {
      returned = true;
    }
  }
  const stop = new AbortController();
  const stream = gate.stream(source(), 'a', stop.signal);
  const first = await stream.next();
  assert.deepEqual(first.value, Buffer.alloc(gate.quantum));
  assert.equal(pulled, 1);
  const next = stream.next();
  await Promise.resolve();
  stop.abort();
  await assert.rejects(next);
  assert.equal(returned, true);
  assert.equal(pulled, 1);
  assert.equal(time.pending, 0);
});

test('tiny chunks cannot drain refills reserved for an eligible larger quantum', async () => {
  const time = virtualClock();
  const gate = new BandwidthGovernor(
    { bytesPerSecond: 65536, perPrincipalBytesPerSecond: 0 },
    ['large', 'tiny'],
    () => true,
    time,
  );
  await gate.acquire('large', gate.quantum);
  let granted = false;
  const large = gate.acquire('large', gate.quantum).then(() => {
    granted = true;
  });
  const tiny = [];
  for (let n = 0; n < 100; n++) {
    tiny.push(gate.acquire('tiny', 64));
    await Promise.resolve();
    time.advance(1);
  }
  await large;
  assert.equal(granted, true);
  assert.equal(time.now(), 100);
  time.advance(200);
  await Promise.all(tiny);
});
