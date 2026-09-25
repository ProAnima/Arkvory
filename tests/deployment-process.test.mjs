import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import {
  command,
  DeploymentCommandTimeout,
  isUnconfirmedTermination,
} from '../apps/deploy/dist/process.js';
import { exclusive } from '../apps/deploy/dist/files.js';
import { removeTestDirectory } from './helpers.mjs';

const helper = fileURLToPath(new URL('./deployment/process-child.mjs', import.meta.url));

test('deployment timeout terminates descendants before returning to the caller', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'depot-process-'));
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
  const directory = await mkdtemp(join(tmpdir(), 'depot-process-lock-'));
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
  const directory = await mkdtemp(join(tmpdir(), 'depot-process-safe-'));
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
