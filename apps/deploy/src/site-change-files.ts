import { lstat, open, readdir, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { readSiteChangeStatus } from '@proanima/arkvory-contracts';
import type { SiteChangeStatus } from '@proanima/arkvory-contracts';
import { jsonFile } from './files.js';
import { missing, readClaimed, removeName } from './mailbox-claim.js';

/** The site-change mailbox (ADR 0077); its inbox is taken only through `mailbox-claim`. */
export function mailbox(root: string) {
  return {
    inbox: join(root, 'updates/inbox'),
    request: join(root, 'updates/inbox/change.json'),
    /** The key of one request is named after it: a key never meets another request. */
    key: (id: string) => join(root, `updates/inbox/${id}.key`),
    status: join(root, 'updates/status/changes.json'),
    claimed: join(root, 'change-request.json'),
    claimedKey: join(root, 'change.key'),
    /** The id of a claimed switchover whose `--move` may have been issued. */
    moving: join(root, 'change-moving'),
  };
}
export type Mailbox = ReturnType<typeof mailbox>;

export const REQUEST_LIMIT = 16384;
export const KEY_LIMIT = 4096;
/** Leftovers of the API in the inbox (a key whose request never came) go after this long. */
const LEFTOVER_MS = 60 * 60 * 1000;

export async function readStatus(path: string): Promise<SiteChangeStatus> {
  try {
    return readSiteChangeStatus(await jsonFile(path));
  } catch (error) {
    if (missing(error))
      return { heartbeatAt: new Date(0).toISOString(), blocked: null, recent: [] };
    throw error;
  }
}

/**
 * Compact, so twenty records stay far below what the API reads. One fixed temporary name: the
 * status directory is written by root only and every write runs under the operation lock, so a
 * file a crash left there is simply replaced by the next write.
 */
export async function writeStatus(path: string, status: SiteChangeStatus): Promise<void> {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, JSON.stringify(status), { mode: 0o644 });
  await rename(temporary, path);
}

async function names(directory: string): Promise<string[]> {
  try {
    return await readdir(directory);
  } catch (error) {
    if (missing(error)) return [];
    throw error;
  }
}

/**
 * Keys and temporary files the API left in the inbox longer than an hour: a request that never
 * came, a crash between two writes. Removed by name, never followed. A time in the future (a clock
 * set back) counts as old too, or the file would outlive any sweep. Also the per-process status
 * temporaries of earlier releases, which a crash left behind.
 */
export async function sweep(box: Mailbox, now: number): Promise<void> {
  for (const name of await names(box.inbox)) {
    if (!name.endsWith('.key') && !(name.startsWith('.') && name.endsWith('.tmp'))) continue;
    const path = join(box.inbox, name);
    const info = await lstat(path).catch(() => null);
    if (info && Math.abs(now - info.mtimeMs) > LEFTOVER_MS) await removeName(path);
  }
  const legacy = new RegExp(`^${basename(box.status).replace('.', '\\.')}\\.\\d+\\.tmp$`);
  const directory = dirname(box.status);
  for (const name of await names(directory))
    if (legacy.test(name)) await removeName(join(directory, name));
}

/** Every step on its own: one that fails does not keep the others, nor the key, from going. */
export async function removeAll(paths: readonly string[]): Promise<void> {
  for (const path of paths) await removeName(path);
}

/**
 * Written and synced right before `crm_resource --move`: only a claim with this marker may have
 * left a move constraint, so only then may a later tick clear it. Without it the agent was killed
 * before the move and `--clear` would drop the operator's own constraints.
 */
export async function markMoving(path: string, id: string): Promise<void> {
  const file = await open(path, 'w', 0o600);
  try {
    await file.writeFile(id);
    await file.sync();
  } finally {
    await file.close();
  }
}

export async function movingFor(path: string, id: string): Promise<boolean> {
  try {
    return (await readClaimed(path, 64)).trim() === id;
  } catch {
    return false;
  }
}

/**
 * A status this release cannot read is kept for an operator: moved aside once (a later one does
 * not replace the first), so the heartbeat written next does not destroy what it said.
 */
export async function keepUnreadable(path: string): Promise<void> {
  const aside = `${path}.unreadable`;
  if (await lstat(aside).catch(() => null)) return;
  await rename(path, aside).catch(() => undefined);
}
