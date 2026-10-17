import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { acquireWithPlan, watchModulePlan } from '../apps/worker/dist/module-plan.js';

const mine = 'a'.repeat(64);
const other = 'b'.repeat(64);
let release = 0;
/**
 * The writer's record with the given compatibility fingerprint. Its full fingerprint changes on
 * every read, like a writer of another release: the worker must not look at it.
 */
const recordedAs = (compatibility) =>
  compatibility === null
    ? null
    : {
        compatibilityFingerprint: compatibility,
        fingerprint: (++release).toString(16).padStart(64, 'c'),
      };

/** A worker start whose lock is a counter; `answers` are the recorded plans it reads in turn. */
function lock(answers, { fail } = {}) {
  const events = [];
  let held = 0;
  let taken = 0;
  return {
    events,
    held: () => held,
    start: {
      acquire: async () => {
        held++;
        taken++;
        events.push('acquire');
        return { id: taken };
      },
      recorded: () => ({
        read: async () => {
          if (fail) throw fail;
          return recordedAs(answers.length > 0 ? answers.shift() : mine);
        },
      }),
      release: async () => {
        held--;
        events.push('release');
      },
      onMismatch: () => {
        events.push('mismatch');
      },
    },
  };
}

test('a worker with another plan gives its lock back while it waits, and reports once', async () => {
  const worker = lock([null, other, other, mine]);
  const acquired = await acquireWithPlan(worker.start, mine, new AbortController().signal, 1);
  assert.deepEqual(acquired, { id: 4 });
  assert.deepEqual(worker.events, [
    'acquire',
    'release',
    'mismatch',
    'acquire',
    'release',
    'acquire',
    'release',
    'acquire',
  ]);
  assert.equal(worker.held(), 1, 'only the matching look keeps the lock');
});

test('stopping a waiting worker ends the wait without the lock; a failed read rejects', async () => {
  const waiting = lock(Array(100).fill(other));
  const stop = new AbortController();
  const result = acquireWithPlan(waiting.start, mine, stop.signal, 60_000);
  while (!waiting.events.includes('mismatch')) await delay(1);
  stop.abort();
  assert.equal(await result, null);
  assert.equal(waiting.held(), 0);

  const failure = new Error('database gone');
  const failing = lock([], { fail: failure });
  await assert.rejects(
    acquireWithPlan(failing.start, mine, new AbortController().signal),
    (error) => error === failure,
  );
  assert.equal(failing.held(), 0, 'the lock is released before the failure propagates');

  const standby = { ...lock([]).start, acquire: async () => null };
  assert.equal(await acquireWithPlan(standby, mine, new AbortController().signal), null);
});

/** Waits for a condition without a fixed delay, so a loaded machine only makes it slower. */
async function until(condition, what) {
  const deadline = performance.now() + 10_000;
  while (!condition()) {
    if (performance.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await delay(2);
  }
}

test('a running worker notices once that the writer changed the plan', async () => {
  let current = mine;
  let reads = 0;
  let changes = 0;
  const recorded = {
    read: async () => {
      reads++;
      if (reads === 2) throw new Error('hiccup');
      return recordedAs(current);
    },
  };
  const unwatch = watchModulePlan(recorded, mine, () => changes++, 5);
  await until(() => reads >= 3, 'three looks');
  assert.equal(changes, 0, 'an equal plan and a failed look change nothing');
  current = other;
  await until(() => changes === 1, 'the change');
  const seen = reads;
  await delay(30);
  unwatch();
  assert.equal(changes, 1);
  assert.equal(reads, seen, 'no further looks once the change was reported');
});
