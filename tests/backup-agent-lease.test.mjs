import test from 'node:test';
import assert from 'node:assert/strict';
import { RenewedAgentLease } from '@proanima/arkvory-infrastructure';

/** A lease of 60 s granted at monotonic 1000; renewals never answer within the test. */
function lease(clock) {
  return new RenewedAgentLease(
    'agent-a',
    3,
    60_000,
    () => new Promise(() => {}),
    1000,
    () => clock.monotonic,
    () => clock.wall,
  );
}

test('the agent trusts its lease for two thirds of it on both clocks', async () => {
  const clock = { monotonic: 1000, wall: 50_000 };
  const held = lease(clock);
  try {
    assert.equal(held.active, true);
    clock.monotonic += 39_000;
    clock.wall += 39_000;
    assert.equal(held.active, true);
    clock.monotonic += 1_000;
    clock.wall += 1_000;
    assert.equal(held.active, false, 'stops before another agent may take over');
    assert.throws(() => held.throwIfAborted());
  } finally {
    await held.close();
  }
});

test('a host that slept stops the agent although the monotonic clock stood still', async () => {
  const clock = { monotonic: 1000, wall: 50_000 };
  const held = lease(clock);
  try {
    clock.wall += 5 * 60_000;
    assert.equal(held.active, false);
  } finally {
    await held.close();
  }
});
