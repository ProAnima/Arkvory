import { open, link, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const missing = (error: unknown) =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT';

/**
 * A regular file of the host mailbox up to `limit` bytes, never through a link; null if absent.
 * The inbox is writable by anyone who can reach it: a FIFO placed there would block a plain open
 * (and a thread of the pool with it) until a writer comes, so it opens without waiting and is
 * refused by the type check.
 */
export async function mailboxJson(path: string, limit = 16384): Promise<unknown> {
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > limit) throw new Error('Invalid mailbox file');
    const buffer = Buffer.alloc(limit + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > limit) throw new Error('Mailbox file too large');
    return JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')) as unknown;
  } finally {
    await file.close();
  }
}

/**
 * Publishes `text` as `directory/name` with exclusive creation: complete bytes first, then one
 * link, then a durable directory entry. False when the name exists (the slot is taken).
 */
export async function publish(
  directory: string,
  name: string,
  text: string,
  mode: number,
): Promise<boolean> {
  const temporary = join(directory, `.${randomUUID()}.tmp`);
  const file = await open(temporary, 'wx', mode);
  try {
    await file.writeFile(text);
    await file.chmod(mode);
    await file.sync();
    await file.close();
    try {
      await link(temporary, join(directory, name));
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'EEXIST') return false;
      throw error;
    }
    // One name as soon as possible: the agent takes a file with two names for one still written.
    await unlink(temporary).catch(() => undefined);
    if (process.platform !== 'win32') {
      const parent = await open(directory, 'r');
      try {
        await parent.sync();
      } finally {
        await parent.close();
      }
    }
    return true;
  } finally {
    await file.close();
    await unlink(temporary).catch(() => undefined);
  }
}
