import { constants } from 'node:fs';
import { lstat, open, rename, rmdir, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';

/**
 * Taking files out of an inbox the API writes (world-writable under Compose): every name there
 * may be a link, a directory or a FIFO. Claimed files move to the root, which only root writes,
 * and are read through a descriptor that never follows a link and never waits.
 */
export const missing = (error: unknown) =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT';

/**
 * Removes one name without ever descending: a link or any other non-directory loses its name
 * only (`unlink` never follows the last component), a directory goes only when empty. Nothing
 * from the inbox is removed recursively: the API (or whoever writes the inbox) could swap a
 * subdirectory for a link to `/etc` while root walks the tree.
 */
export async function removeName(path: string): Promise<void> {
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
    // An empty directory just goes. A full one goes back: whoever swapped it in may still hold a
    // descriptor inside it, so emptying it here could be led anywhere. Back in the inbox it is a
    // name like any other the inbox's writers can leave; the sweep removes it once empty.
    await removeName(to);
    if (info.isDirectory() && (await lstat(to).catch(() => null)))
      await rename(to, join(dirname(from), `.refused-${randomUUID()}.tmp`)).catch(() => undefined);
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
