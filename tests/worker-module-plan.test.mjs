import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { awaitModulePlan, watchModulePlan } from '../apps/worker/dist/module-plan.js';

const mine = 'a'.repeat(64);
const other = 'b'.repeat(64);

test('a worker waits for the writer to record its plan and reports the mismatch once', async () => {
  const answers = [null, other, other, mine];
  const recorded = { read: async () => (answers.length > 0 ? answers.shift() : mine) };
  let reported = 0;
  const stop = new AbortController();
  assert.equal(await awaitModulePlan(recorded, mine, stop.signal, () => reported++, 1), true);
  assert.equal(reported, 1);
  assert.deepEqual(answers, []);
});

test('stopping a waiting worker ends the wait without work; a failed read rejects', async () => {
  const stop = new AbortController();
  const waiting = awaitModulePlan({ read: async () => other }, mine, stop.signal, () => {}, 60_000);
  await delay(10);
  stop.abort();
  assert.equal(await waiting, false);
  const failure = new Error('database gone');
  await assert.rejects(
    awaitModulePlan(
      { read: () => Promise.reject(failure) },
      mine,
      new AbortController().signal,
      () => {},
    ),
    (error) => error === failure,
  );
});

test('a running worker notices once that the writer changed the plan', async () => {
  let current = mine;
  let reads = 0;
  let changes = 0;
  const recorded = {
    read: async () => {
      reads++;
      if (reads === 2) throw new Error('hiccup');
      return current;
    },
  };
  const unwatch = watchModulePlan(recorded, mine, () => changes++, 5);
  await delay(40);
  assert.equal(changes, 0, 'an equal plan and a failed look change nothing');
  current = other;
  await delay(40);
  unwatch();
  assert.equal(changes, 1);
});
