import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareMirrors } from '../apps/worker/dist/mirror-loop.js';

function diagnostics() {
  const lines = [];
  return { lines, write: (line) => lines.push(line) };
}
const options = (stop, log) => ({
  mirrors: [{ repository: 'releases' }],
  stop,
  diagnostics: log,
});

test('a database away at startup delays the detach mark instead of ending the worker', async () => {
  const log = diagnostics();
  const calls = [];
  let failures = 2;
  const ready = await prepareMirrors(
    {
      markDetached: async (configured) => {
        calls.push(`mark ${configured.join(',')}`);
        if (failures-- > 0) throw Object.assign(new Error('gone'), { code: 'ECONNREFUSED' });
      },
      clearStaging: async () => {
        calls.push('clear');
      },
    },
    options(new AbortController().signal, log),
    () => true,
    () => 1,
  );
  assert.equal(ready, true);
  assert.deepEqual(calls, ['mark releases', 'mark releases', 'mark releases', 'clear']);
  assert.deepEqual(
    log.lines.map((line) => [line.code, line.errorCode, line.attempts, line.errno]),
    [
      ['mirror.step_failed', 'mirror_startup_failed', 1, 'ECONNREFUSED'],
      ['mirror.step_failed', 'mirror_startup_failed', 2, 'ECONNREFUSED'],
    ],
  );
});

test('part files that cannot be cleared are reported and the mirrors still start', async () => {
  const log = diagnostics();
  const ready = await prepareMirrors(
    {
      markDetached: async () => undefined,
      clearStaging: async () => {
        throw Object.assign(new Error('busy'), { code: 'EBUSY' });
      },
    },
    options(new AbortController().signal, log),
    () => true,
  );
  assert.equal(ready, true);
  assert.equal(log.lines[0].errorCode, 'mirror_staging_failed');
});

test('a stop or lost ownership ends the retries without starting any mirror', async () => {
  const stop = new AbortController();
  let marks = 0;
  const startup = {
    markDetached: async () => {
      marks++;
      stop.abort();
      throw new Error('gone');
    },
    clearStaging: async () => assert.fail('nothing is cleared before the mark'),
  };
  assert.equal(
    await prepareMirrors(startup, options(stop.signal, diagnostics()), () => true),
    false,
  );
  assert.equal(marks, 1);
  const running = new AbortController().signal;
  assert.equal(await prepareMirrors(startup, options(running, diagnostics()), () => false), false);
  assert.equal(marks, 1, 'a worker that lost its storage marks nothing');
});
