import test from 'node:test';
import assert from 'node:assert/strict';
import { runnerExitCode, waitForReady } from '../apps/deploy/dist/database-runner.js';

/** A clock that advances one second per pause, and a probe answering from a list. */
function server(answers, exitAfter = Infinity) {
  let time = 0;
  let probes = 0;
  return {
    probe: async () => answers[Math.min(probes++, answers.length - 1)],
    exited: () => probes >= exitAfter,
    wait: {
      silenceMs: 60000,
      now: () => time,
      pause: async () => {
        time += 1000;
      },
    },
    probes: () => probes,
  };
}

test('a long crash recovery is waited for; it is never stopped midway', async () => {
  // Ten minutes of WAL replay (pg_isready: 1, rejecting), then ready.
  const recovering = server([...Array(600).fill(1), 0]);
  await waitForReady(recovering.probe, recovering.exited, recovering.wait);
  assert.equal(recovering.probes(), 601);
});

test('a server that never answers, or exits, fails the start', async () => {
  const silent = server([2]);
  await assert.rejects(
    waitForReady(silent.probe, silent.exited, silent.wait),
    /did not become ready/,
  );
  assert.equal(silent.probes(), 61);
  // Answering again restarts the window: silence counts only since the last answer.
  const flapping = server([...Array(50).fill(2), 1, ...Array(50).fill(2), 0]);
  await waitForReady(flapping.probe, flapping.exited, flapping.wait);
  const gone = server([1], 3);
  await assert.rejects(waitForReady(gone.probe, gone.exited, gone.wait), /exited before/);
});

test('a requested stop ends clean; any other exit of PostgreSQL is a failure', () => {
  assert.equal(runnerExitCode(0, true), 0);
  assert.equal(runnerExitCode(null, true), 1);
  assert.equal(runnerExitCode(3, true), 3);
  assert.equal(runnerExitCode(0, false), 1);
  assert.equal(runnerExitCode(null, false), 1);
});
