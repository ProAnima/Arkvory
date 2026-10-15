import test from 'node:test';
import assert from 'node:assert/strict';
import { followDelay } from '../apps/web/dist/fleet-presentation.js';

test('the agent panel keeps following after failed looks, waiting longer up to a minute', () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 50].map(followDelay),
    [5000, 10000, 20000, 40000, 60000, 60000, 60000],
  );
});
