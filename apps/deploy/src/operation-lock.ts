import { mkdir, open, readFile, unlink, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { exists } from './files.js';
import { NODE_MARKER } from './cluster-node.js';
import { report } from './output.js';
import { isUnconfirmedTermination } from './process.js';

const LOCKED =
  'Installation is locked. After a crash, stop the updater and inspect journal.json before removing operation.lock';
const SETTLED = ['committed', 'rolled-back', 'recovered'];

interface LockOwner {
  readonly pid: number;
  readonly host: string;
}

function owner(text: string): LockOwner | null {
  try {
    const value = JSON.parse(text) as Record<string, unknown>;
    // A lock kept for operator reconciliation is never stale, whatever its process.
    if (!Number.isSafeInteger(value['pid']) || value['preserved'] === true) return null;
    // Locks of earlier releases carry no host and no preserved mark: an operator handles them.
    if (typeof value['host'] !== 'string') return null;
    return { pid: value['pid'] as number, host: value['host'] };
  } catch {
    // Empty while its writer is still writing it, or damaged: never treated as stale.
    return null;
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists under another account.
    return !(error instanceof Error && 'code' in error && error.code === 'ESRCH');
  }
}

/** True when the journal shows no deployment step that an operator must reconcile first. */
async function settled(root: string): Promise<boolean> {
  try {
    const journal = JSON.parse(await readFile(join(root, 'journal.json'), 'utf8')) as unknown;
    const phase = (journal as Record<string, unknown> | null)?.['phase'];
    return SETTLED.includes(String(phase));
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT';
  }
}

/**
 * Whether the lock is left by a process that cannot run any more and that changed nothing an
 * operator must inspect: its process is gone on this host, or, on a node of an HA cluster
 * (ADR 0072), it was taken on another node, which Pacemaker fenced before this one mounted the
 * volume. An interrupted deployment (journal not settled) always keeps the lock.
 */
export async function staleLock(
  root: string,
  text: string,
  clusterNode: boolean,
  here = hostname(),
): Promise<boolean> {
  const held = owner(text);
  if (!held || !(await settled(root))) return false;
  if (held.host === here) return !alive(held.pid);
  return clusterNode;
}

async function releaseStale(root: string, path: string): Promise<boolean> {
  const text = await readFile(path, 'utf8').catch(() => '');
  const clusterNode = process.platform !== 'win32' && (await exists(NODE_MARKER));
  if (!(await staleLock(root, text, clusterNode))) return false;
  // Re-read right before removing: never remove a lock another process has just taken.
  if ((await readFile(path, 'utf8').catch(() => '')) !== text) return false;
  await unlink(path).catch(() => undefined);
  report('warning', `Removed the operation lock of a process that no longer runs: ${text}`);
  return true;
}

/**
 * A lock that its holder will release by itself: a running operation, or one still writing the
 * lock. A preserved lock or an unsettled journal waits for an operator instead.
 */
async function transient(root: string, text: string): Promise<boolean> {
  if (text === '') return true;
  try {
    const value = JSON.parse(text) as Record<string, unknown>;
    if (value['preserved'] === true) return false;
  } catch {
    return false;
  }
  return settled(root);
}

async function acquire(root: string, path: string, waitMs: number) {
  const deadline = Date.now() + waitMs;
  let told = false;
  for (;;) {
    try {
      return await open(path, 'wx', 0o600);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST'))
        throw new Error(LOCKED, { cause: error });
    }
    if (await releaseStale(root, path)) continue;
    const text = await readFile(path, 'utf8').catch(() => '');
    if (Date.now() >= deadline || !(await transient(root, text))) throw new Error(LOCKED);
    if (!told) report('info', 'Waiting for another Arkvory operation on this installation to end');
    told = true;
    await sleep(500);
  }
}

/**
 * Runs `work` under the installation's operation lock. With `waitMs`, a lock that another
 * operation holds normally (an update check started by the timer, say) is waited for that long;
 * an operator's command then does not fail on a check that ends in seconds.
 */
export async function exclusive<T>(root: string, work: () => Promise<T>, waitMs = 0): Promise<T> {
  await mkdir(root, { recursive: true });
  const path = join(root, 'operation.lock');
  const lock = await acquire(root, path, waitMs);
  let preserveLock = false;
  try {
    await lock.writeFile(
      JSON.stringify({ pid: process.pid, host: hostname(), startedAt: new Date().toISOString() }),
    );
    await lock.sync();
    return await work();
  } catch (error) {
    // Unconfirmed descendants may still mutate installation state. Only operator reconciliation
    // can release this barrier; a timeout must not silently permit another deployment.
    preserveLock = isUnconfirmedTermination(error);
    throw error;
  } finally {
    await lock.close();
    if (!preserveLock) await unlink(path);
    else
      await writeFile(
        path,
        JSON.stringify({ pid: process.pid, host: hostname(), preserved: true }),
      ).catch(() => undefined);
  }
}
