import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, access, unlink, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import {
  command,
  commandOutput,
  DeploymentCommandTimeout,
  isUnconfirmedTermination,
} from '../apps/deploy/dist/process.js';
import { exclusive, staleLock } from '../apps/deploy/dist/operation-lock.js';
import { removeTestDirectory } from './helpers.mjs';

const helper = fileURLToPath(new URL('./deployment/process-child.mjs', import.meta.url));

test('deployment timeout terminates descendants before returning to the caller', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'arkvory-process-'));
  t.after(async () => {
    // Keep this regression's own cleanup effective even when the implementation is broken.
    for (const role of ['descendant', 'parent']) {
      const record = await readFile(join(directory, `${role}.json`), 'utf8').catch(() => null);
      if (record) {
        try {
          process.kill(JSON.parse(record).pid, 'SIGKILL');
        } catch (error) {
          if (error.code !== 'ESRCH') throw error;
        }
      }
    }
    await removeTestDirectory(directory);
  });
  let failure;
  await assert.rejects(
    exclusive(directory, () =>
      command(process.execPath, [helper, directory, 'parent'], undefined, undefined, {
        timeoutMs: 3000,
        terminationTimeoutMs: 5000,
      }),
    ),
    (error) => {
      failure = error;
      return error instanceof DeploymentCommandTimeout;
    },
  );
  const before = await readFile(join(directory, 'heartbeat'), 'utf8');
  assert(before.length > 0, 'The descendant must run before the timeout');
  await delay(150);
  assert.equal(await readFile(join(directory, 'heartbeat'), 'utf8'), before);
  // Some container PID 1 implementations leave killed descendants as zombies. If the OS
  // cannot confirm the group disappeared, retaining the lock is the safe outcome.
  if (failure.terminationConfirmed)
    await assert.rejects(access(join(directory, 'operation.lock')), { code: 'ENOENT' });
  else await access(join(directory, 'operation.lock'));
});

test('unconfirmed termination preserves operation lock through a bounded cause chain', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'arkvory-process-lock-'));
  t.after(() => removeTestDirectory(directory));
  const failure = new Error('Outer operation failed', {
    cause: new DeploymentCommandTimeout(false),
  });
  await assert.rejects(
    exclusive(directory, async () => {
      throw failure;
    }),
    (error) => error === failure,
  );
  await access(join(directory, 'operation.lock'));
  await assert.rejects(
    exclusive(directory, async () => {}),
    /Installation is locked/,
  );
});

test('confirmed timeout releases operation lock and normal commands still work', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'arkvory-process-safe-'));
  t.after(() => removeTestDirectory(directory));
  await assert.rejects(
    exclusive(directory, async () => {
      throw new DeploymentCommandTimeout(true);
    }),
    /timed out/,
  );
  await exclusive(directory, () => command(process.execPath, [helper, directory, 'exit']));
  await assert.rejects(access(join(directory, 'operation.lock')), { code: 'ENOENT' });
  await assert.rejects(command(join(directory, 'missing-executable'), []), /Cannot start/);
});

test('termination uncertainty inspection neither loops nor invokes a cause getter', () => {
  const cycle = new Error('cycle');
  cycle.cause = cycle;
  assert.equal(isUnconfirmedTermination(cycle), false);
  assert.equal(
    isUnconfirmedTermination(
      Object.defineProperty({}, 'cause', {
        get() {
          throw new Error('Getter must not execute');
        },
      }),
    ),
    false,
  );
  assert.equal(isUnconfirmedTermination(new DeploymentCommandTimeout(false)), true);
});

test('captured commands return stdout, keep failures and refuse unbounded output', async () => {
  const node = (script) => commandOutput(process.execPath, ['-e', script]);
  assert.equal(await node('console.log("first"); console.log("{}")'), 'first\n{}\n');
  await assert.rejects(node('process.exit(3)'), /Deployment command failed \(3\)/);
  // A result line is small; a command that keeps printing is a broken contract.
  await assert.rejects(node('process.stdout.write("x".repeat(70000))'), /more output/);
});

test('a lock left by a process that no longer runs is taken over; anything uncertain stays locked', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'arkvory-process-stale-'));
  t.after(() => removeTestDirectory(root));
  // A pid that existed and is gone now.
  const gone = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], {
    encoding: 'utf8',
  }).stdout;
  const lock = (fields) => JSON.stringify({ pid: Number(gone), host: hostname(), ...fields });
  assert.equal(await staleLock(root, lock({}), false), true, 'its process is gone');
  assert.equal(await staleLock(root, lock({ pid: process.pid }), false), false, 'still running');
  assert.equal(
    await staleLock(root, lock({ preserved: true }), false),
    false,
    'kept for an operator',
  );
  assert.equal(
    await staleLock(root, JSON.stringify({ pid: Number(gone) }), false),
    false,
    'older release',
  );
  assert.equal(await staleLock(root, '', false), false, 'still being written');
  // Another host: stale only on an HA node, where the old active node has been fenced.
  assert.equal(await staleLock(root, lock({ host: 'node-b' }), false), false);
  assert.equal(await staleLock(root, lock({ host: 'node-b' }), true), true);
  // An interrupted deployment always waits for an operator.
  await writeFile(join(root, 'journal.json'), JSON.stringify({ phase: 'switching' }));
  assert.equal(await staleLock(root, lock({}), false), false);
  assert.equal(await staleLock(root, lock({ host: 'node-b' }), true), false);
  await writeFile(join(root, 'journal.json'), JSON.stringify({ phase: 'committed' }));
  // exclusive() takes over the stale lock and leaves none behind.
  await writeFile(join(root, 'operation.lock'), lock({}));
  assert.equal(await exclusive(root, async () => 'ran'), 'ran');
  await assert.rejects(access(join(root, 'operation.lock')), { code: 'ENOENT' });
});

test('an operator command waits for a running operation; a lock kept for an operator refuses at once', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'arkvory-process-wait-'));
  t.after(() => removeTestDirectory(root));
  const path = join(root, 'operation.lock');
  const running = JSON.stringify({ pid: process.pid, host: hostname() });
  await writeFile(path, running);
  // Without a wait, as the update timer's tick runs: refused.
  await assert.rejects(
    exclusive(root, async () => {}),
    /Installation is locked/,
  );
  // The running operation ends within the wait: the command then runs.
  const ended = delay(800).then(() => unlink(path));
  assert.equal(await exclusive(root, async () => 'ran', 10_000), 'ran');
  await ended;
  // Kept for an operator, or after an interrupted deployment: no wait helps.
  await writeFile(path, JSON.stringify({ pid: process.pid, host: hostname(), preserved: true }));
  let started = Date.now();
  await assert.rejects(
    exclusive(root, async () => {}, 10_000),
    /Installation is locked/,
  );
  assert.ok(Date.now() - started < 2000);
  await writeFile(path, running);
  await writeFile(join(root, 'journal.json'), JSON.stringify({ phase: 'switching' }));
  started = Date.now();
  await assert.rejects(
    exclusive(root, async () => {}, 10_000),
    /Installation is locked/,
  );
  assert.ok(Date.now() - started < 2000);
  // A wait has an end.
  await writeFile(join(root, 'journal.json'), JSON.stringify({ phase: 'committed' }));
  await assert.rejects(
    exclusive(root, async () => {}, 600),
    /Installation is locked/,
  );
});
