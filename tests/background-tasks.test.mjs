import test from 'node:test';
import assert from 'node:assert/strict';
import { registerBackgroundTasks } from '../apps/api/dist/background-tasks.js';

test('stopping the background tasks aborts a fleet round in flight instead of waiting it out', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const hooks = {};
  const app = {
    addHook: (name, hook) => {
      hooks[name] = hook;
    },
  };
  let signal;
  let closed = false;
  const tasks = registerBackgroundTasks(app, {
    role: 'api',
    available: () => true,
    maintain: async () => undefined,
    fleet: (given) => {
      signal = given;
      // A round of dead sites: it ends only when aborted.
      return new Promise((resolve) => given.addEventListener('abort', () => resolve()));
    },
    flush: async () => undefined,
    close: () => {
      closed = true;
    },
    diagnostics: { write: () => assert.fail('a cancelled round is no failure') },
  });
  await hooks.onReady();
  t.mock.timers.tick(30000);
  assert.equal(signal?.aborted, false);
  await tasks.stop();
  assert.equal(signal.aborted, true);
  assert.equal(closed, true);
});
