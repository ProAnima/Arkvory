import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCleanupPolicy, defaultCleanupPolicy } from '@proanima/depot-domain';
import { readCleanupPolicy, readCleanupSnapshot } from '@proanima/depot-contracts';

test('cleanup bounds are enforced at both domain and wire boundaries', () => {
  assert.deepEqual(
    readCleanupPolicy(defaultCleanupPolicy),
    parseCleanupPolicy(defaultCleanupPolicy),
  );
  for (const invalid of [
    { enabled: 1 },
    { graceHours: -1 },
    { batchSize: 101 },
    { intervalSeconds: 0 },
    { delayMilliseconds: 1001 },
  ])
    for (const parse of [parseCleanupPolicy, readCleanupPolicy])
      assert.throws(() => parse({ ...defaultCleanupPolicy, ...invalid }));
  assert.throws(() => parseCleanupPolicy({ ...defaultCleanupPolicy, unknown: true }));
  const state = {
    revision: 1,
    policy: defaultCleanupPolicy,
    lastRunAt: null,
    nextRunAt: null,
    lastCollected: 2,
    lastDeferred: 1,
    lastFailed: 0,
    lastReclaimedBytes: '5368709120',
    lastError: null,
  };
  assert.deepEqual(readCleanupSnapshot(state), state);
  for (const invalid of [
    { lastReclaimedBytes: '-1' },
    { lastRunAt: 'yesterday' },
    { lastCollected: 101 },
    { lastError: 'token secret' },
  ])
    assert.throws(() => readCleanupSnapshot({ ...state, ...invalid }));
});
