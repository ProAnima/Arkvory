import test from 'node:test';
import assert from 'node:assert/strict';
import { OwnershipWindow } from '../packages/infrastructure/dist/ownership-window.js';

test('storage ownership observation includes latency and cannot revive after expiry', () => {
  let mono = 0,
    wall = 100000;
  const window = new OwnershipWindow(
    () => mono,
    () => wall,
  );
  assert.equal(window.active, false);
  const start = window.begin();
  mono += 7000;
  wall += 7000;
  window.accept(start);
  assert.equal(window.active, true);
  const pending = window.begin();
  mono += 1000;
  wall += 1000;
  assert.equal(window.active, false);
  assert.throws(() => window.accept(pending), { code: 'unavailable' });
  assert.throws(() => window.accept(window.begin()), { code: 'unavailable' });
});

test('storage owner fails closed on suspend, clock rollback and explicit stop', () => {
  for (const failure of ['suspend', 'rollback', 'stop', 'late-start']) {
    let mono = 0,
      wall = 100000;
    const window = new OwnershipWindow(
      () => mono,
      () => wall,
    );
    const start = window.begin();
    if (failure === 'late-start') {
      mono += 8000;
      assert.throws(() => window.accept(start), { code: 'unavailable' });
    } else {
      window.accept(start);
      if (failure === 'suspend') wall += 8000;
      if (failure === 'rollback') {
        mono += 8000;
        wall -= 10000;
      }
      if (failure === 'stop') window.stop();
    }
    assert.equal(window.active, false);
    assert.throws(() => window.accept(window.begin()), { code: 'unavailable' });
  }
});
