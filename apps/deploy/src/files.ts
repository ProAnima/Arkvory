import { constants } from 'node:fs';
import {
  open,
  mkdir,
  readFile,
  rename,
  unlink,
  lstat,
  stat,
  copyFile,
  chmod,
  access,
} from 'node:fs/promises';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isUnconfirmedTermination } from './process.js';

export function inside(root: string, ...parts: string[]): string {
  const path = resolve(root, ...parts);
  const delta = relative(resolve(root), path);
  if (!delta || delta.startsWith('..') || isAbsolute(delta))
    throw new Error('Path must remain inside installation');
  return path;
}
export async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}
export async function jsonFile(path: string): Promise<unknown> {
  const info = await lstat(path);
  if (!info.isFile() || info.size > 1024 * 1024) throw new Error('Invalid configuration file');
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}
export async function atomicJson(path: string, value: unknown): Promise<void> {
  await atomicText(path, JSON.stringify(value, null, 2) + '\n');
}
export async function atomicText(path: string, value: string, mode = 0o644): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const file = await open(temporary, 'wx', mode);
  try {
    await file.writeFile(value);
    await file.chmod(mode);
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temporary, path);
  await syncDirectory(dirname(path));
}
/**
 * Replaces an existing configuration file atomically and keeps its mode, owner and group. A new
 * inode belongs to the writer (root); without the old group the service account (root:arkvory
 * 0640 on Linux) could no longer read the file after a restart.
 */
export async function replaceText(path: string, value: string): Promise<void> {
  const info = await stat(path);
  const mode = info.mode & 0o777;
  const temporary = `${path}.${randomUUID()}.tmp`;
  const file = await open(temporary, 'wx', mode);
  try {
    try {
      await file.writeFile(value);
      await file.chmod(mode);
      if (process.platform !== 'win32') await file.chown(info.uid, info.gid);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  await syncDirectory(dirname(path));
}
/** Copies a file into place through a temporary sibling, so readers never see a partial copy. */
export async function atomicCopy(source: string, path: string, mode: number): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await copyFile(source, temporary, constants.COPYFILE_EXCL);
    await chmod(temporary, mode);
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  await syncDirectory(dirname(path));
}
export async function syncDirectory(path: string): Promise<void> {
  // POSIX directory fsync makes pointer replacement durable. Windows does not expose directory fsync.
  if (process.platform !== 'win32') {
    const directory = await open(path, 'r');
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }
}
export async function exclusive<T>(root: string, work: () => Promise<T>): Promise<T> {
  await mkdir(root, { recursive: true });
  const path = join(root, 'operation.lock');
  const lock = await open(path, 'wx', 0o600).catch(() => {
    throw new Error(
      'Installation is locked. After a crash, stop the updater and inspect journal.json before removing operation.lock',
    );
  });
  let preserveLock = false;
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
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
  }
}
