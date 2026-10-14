import { constants } from 'node:fs';
import { lstat, open, readdir, rename, rmdir, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { readSiteChangeStatus } from '@proanima/arkvory-contracts';
import type { SiteChangeStatus } from '@proanima/arkvory-contracts';
import { jsonFile } from './files.js';

/**
 * The API writes only into `updates/inbox` (world-writable under Compose): every name there may be
 * a link, a directory or a FIFO. Claimed files move to the root, which only root writes, and are
 * read through a descriptor that never follows a link and never waits.
 */
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

export const missing = (error: unknown) =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT';

/**
 * Removes one name without ever descending: a link or any other non-directory loses its name
 * only (`unlink` never follows the last component), a directory goes only when empty. Nothing
 * from the inbox is removed recursively: the API (or whoever writes the inbox) could swap a
 * subdirectory for a link to `/etc` while root walks the tree.
 */
async function removeName(path: string): Promise<void> {
  const info = await lstat(path).catch(() => null);
  if (!info) return;
  await (info.isDirectory() ? rmdir(path) : unlink(path)).catch(() => undefined);
}

/**
 * Moves `from` to `to`, then checks what arrived: anything but a regular file with one name is
 * refused. Anything else than a regular file is refused before the move, so a directory is never
 * taken into the root; one swapped in between is put back into the inbox under a name the sweep
 * removes (empty) or leaves. False when nothing was there.
 */
export async function claim(from: string, to: string): Promise<boolean> {
  const before = await lstat(from).catch(() => null);
  if (!before) return false;
  if (!before.isFile()) {
    // A link, FIFO or socket loses its name; a directory goes only when empty.
    await removeName(from);
    throw new Error(`${from} is not a regular file; refused`);
  }
  // The API links a complete temporary file to the name and removes the temporary right after:
  // two names mean it is still publishing. Taken on the next tick, not refused.
  if (before.nlink > 1) return false;
  try {
    await rename(from, to);
  } catch (error) {
    if (missing(error)) return false;
    throw error;
  }
  const info = await lstat(to);
  if (!info.isFile() || info.nlink !== 1) {
    if (info.isDirectory())
      await rename(to, join(dirname(from), `.refused-${randomUUID()}.tmp`)).catch(() => undefined);
    else await removeName(to);
    throw new Error(`${from} was not a regular file; refused`);
  }
  return true;
}

/** The text of a claimed file through a descriptor that follows no link and never waits. */
export async function readClaimed(path: string, limit: number): Promise<string> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size > limit)
      throw new Error(`${path} is not a small regular file`);
    const buffer = Buffer.alloc(limit + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > limit) throw new Error(`${path} grew while read`);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await file.close();
  }
}

export async function readStatus(path: string): Promise<SiteChangeStatus> {
  try {
    return readSiteChangeStatus(await jsonFile(path));
  } catch (error) {
    if (missing(error))
      return { heartbeatAt: new Date(0).toISOString(), blocked: null, recent: [] };
    throw error;
  }
}

/** Compact, so twenty records stay far below what the API reads. */
export async function writeStatus(path: string, status: SiteChangeStatus): Promise<void> {
  const temporary = `${path}.${String(process.pid)}.tmp`;
  await writeFile(temporary, JSON.stringify(status), { mode: 0o644 });
  await rename(temporary, path);
}

/**
 * Keys and temporary files the API left in the inbox longer than an hour: a request that never
 * came, a crash between two writes. Removed by name, never followed.
 */
export async function sweep(box: Mailbox, now: number): Promise<void> {
  let names: string[];
  try {
    names = await readdir(box.inbox);
  } catch (error) {
    if (missing(error)) return;
    throw error;
  }
  for (const name of names) {
    if (!name.endsWith('.key') && !(name.startsWith('.') && name.endsWith('.tmp'))) continue;
    const path = join(box.inbox, name);
    const info = await lstat(path).catch(() => null);
    if (info && now - info.mtimeMs > LEFTOVER_MS) await removeName(path);
  }
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
