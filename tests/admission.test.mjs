import test from 'node:test';
import assert from 'node:assert/strict';
import { AdmissionQueue } from '@proanima/arkvory-infrastructure';

test('gateway admission is bounded, rotates clients, cancels waiters and releases exactly once', async () => {
  const gate = new AdmissionQueue(1, 3, 2, 1000);
  const first = await gate.acquire('a');
  const a = gate.acquire('a');
  const b = gate.acquire('b');
  first();
  const rb = await b;
  assert.equal(gate.snapshot.active, 1);
  rb();
  const ra = await a;
  const abort = new AbortController();
  const cancelled = gate.acquire('c', abort.signal);
  abort.abort();
  await assert.rejects(cancelled, { code: 'busy' });
  assert.equal(gate.snapshot.waiting, 0);
  const pending = gate.acquire('c');
  const second = gate.acquire('c');
  await assert.rejects(gate.acquire('c'), { code: 'busy' });
  gate.close();
  await assert.rejects(pending, { code: 'unavailable' });
  await assert.rejects(second, { code: 'unavailable' });
  ra();
  ra();
  assert.equal(gate.snapshot.active, 0);
});
test('gateway wait timeout does not reserve a slot', async () => {
  const gate = new AdmissionQueue(1, 2, 1, 10);
  const release = await gate.acquire('a');
  await assert.rejects(gate.acquire('b'), { code: 'busy' });
  release();
  assert.equal(gate.snapshot.waiting, 0);
  assert.equal(gate.snapshot.active, 0);
});

test('per-principal active cap leaves free slots usable by other clients and close is permanent', async () => {
  const gate = new AdmissionQueue(3, 8, 4, 1000, 1);
  const first = await gate.acquire('a');
  const same = gate.acquire('a');
  const other = await gate.acquire('b');
  assert.equal(gate.snapshot.active, 2);
  assert.equal(gate.snapshot.waiting, 1);
  first();
  const resumed = await same;
  other();
  resumed();
  assert.equal(gate.snapshot.active, 0);
  gate.close();
  await assert.rejects(gate.acquire('a'), { code: 'unavailable' });
});
