import { mkdir, open, readFile, unlink, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';
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

export async function exclusive<T>(root: string, work: () => Promise<T>): Promise<T> {
  await mkdir(root, { recursive: true });
  const path = join(root, 'operation.lock');
  const take = () => open(path, 'wx', 0o600);
  const lock = await take()
    .catch(async () => {
      if (await releaseStale(root, path)) return take();
      throw new Error(LOCKED);
    })
    .catch(() => {
      throw new Error(LOCKED);
    });
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
