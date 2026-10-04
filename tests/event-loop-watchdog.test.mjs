import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DEFAULT_WATCHDOG_SECONDS, watchdogSeconds } from '@proanima/arkvory-infrastructure';

const child = fileURLToPath(new URL('./watchdog-child.mjs', import.meta.url));

function run(mode) {
  return new Promise((resolve) => {
    const started = Date.now();
    const process_ = spawn(process.execPath, [child, mode], { windowsHide: true });
    let stdout = '';
    let stderr = '';
    process_.stdout.on('data', (chunk) => (stdout += chunk));
    process_.stderr.on('data', (chunk) => (stderr += chunk));
    process_.on('close', (code, signal) => {
      resolve({ code, signal, stdout, stderr, seconds: (Date.now() - started) / 1000 });
    });
  });
}

test('a stalled main thread is killed with a record, so the supervisor restarts it', async () => {
  const result = await run('stall');
  assert.equal(result.stdout.includes('not killed'), false);
  // SIGKILL on Linux; TerminateProcess with exit code 1 on Windows: a failure for every supervisor.
  assert.ok(result.signal === 'SIGKILL' || result.code === 1, JSON.stringify(result));
  assert.ok(result.seconds < 10, `killed after ${String(result.seconds)} s`);
  const record = JSON.parse(result.stderr.trim().split('\n').at(-1));
  assert.equal(record.code, 'process.stalled');
  assert.equal(record.component, 'process');
  assert.equal(record.service, 'test');
  assert.ok(record.stalledSeconds >= 1);
});

test('short synchronous work keeps the heartbeat; a disabled watchdog never kills', async () => {
  const alive = await run('alive');
  assert.equal(alive.code, 0, alive.stderr);
  assert.equal(alive.stdout.trim(), 'alive');
  const off = await run('off');
  assert.equal(off.code, 0, off.stderr);
  assert.equal(off.stdout.trim(), 'not killed');
});

test('ARKVORY_WATCHDOG_SECONDS is the default, 0, or 10 to 3600 seconds', () => {
  assert.equal(watchdogSeconds(undefined), DEFAULT_WATCHDOG_SECONDS);
  assert.equal(watchdogSeconds(''), DEFAULT_WATCHDOG_SECONDS);
  assert.equal(watchdogSeconds('0'), 0);
  assert.equal(watchdogSeconds('120'), 120);
  for (const value of ['5', '3601', '-1', '1.5', 'sixty', '0060'])
    assert.throws(() => watchdogSeconds(value), /ARKVORY_WATCHDOG_SECONDS/, value);
});

test('the watcher runs whatever the input type of its parent (eval as an ES module)', async () => {
  const source = [
    "import { startEventLoopWatchdog } from '@proanima/arkvory-infrastructure';",
    'startEventLoopWatchdog({ seconds: 1, intervalMs: 100, fields: {}, onError: (error) => {',
    "  process.stderr.write('watchdog failed: ' + String(error));",
    '  process.exit(3);',
    '} });',
    'setTimeout(() => { const end = Date.now() + 20000; while (Date.now() < end); }, 300);',
  ].join('\n');
  const result = await new Promise((resolve) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', source], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      windowsHide: true,
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('close', (code, signal) => resolve({ code, signal, stderr }));
  });
  assert.ok(result.signal === 'SIGKILL' || result.code === 1, JSON.stringify(result));
  assert.match(result.stderr, /process\.stalled/);
});
