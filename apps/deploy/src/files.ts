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
/** Owner of a file as `stat` reports it; applied with chown on POSIX, ignored on Windows. */
export interface FileOwner {
  readonly uid: number;
  readonly gid: number;
}
/** The user of the Compose containers (`node` of the image, uid and gid 1000), who reads the secrets mounted for it. */
export const CONTAINER_USER = 1000;

/**
 * Writes a file through a temporary sibling with this mode (and owner), so readers never see a
 * partial file and the final name never exists with looser permissions. The temporary file may
 * hold a secret, so it is removed when writing or renaming fails.
 */
export async function atomicText(
  path: string,
  value: string,
  mode = 0o644,
  owner?: FileOwner,
): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const file = await open(temporary, 'wx', mode);
  try {
    try {
      await file.writeFile(value);
      await file.chmod(mode);
      if (owner && process.platform !== 'win32') await file.chown(owner.uid, owner.gid);
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
/** Text of a file, or null when it does not exist; any other error is thrown. */
export async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}
/** A file as a rollback needs it back: text, mode and owner; null when it did not exist. */
export interface FileSnapshot {
  readonly text: string;
  readonly mode: number;
  readonly owner: FileOwner;
}
export async function snapshotFile(path: string): Promise<FileSnapshot | null> {
  const text = await readOptional(path);
  if (text === null) return null;
  const info = await stat(path);
  return { text, mode: info.mode & 0o777, owner: { uid: info.uid, gid: info.gid } };
}
/**
 * Puts a file back as the snapshot saw it, with its mode and owner: a restored secret must stay
 * readable by the account that read it before (the service group, or the container user). A file
 * that did not exist is removed.
 */
export async function restoreFile(path: string, before: FileSnapshot | null): Promise<void> {
  if (before === null) await unlink(path).catch(() => undefined);
  else await atomicText(path, before.text, before.mode, before.owner);
}
/**
 * A secret or key the operator names by absolute path: one line of 16 to 4000 printable ASCII
 * characters in a file of at most 4 KiB. The value is never part of a message.
 */
export async function readSecretFile(
  file: string | undefined,
  option: string,
  invalid = `--${option} must hold a secret of at least 16 printable characters`,
): Promise<string> {
  if (!file || !isAbsolute(file)) throw new Error(`--${option} must be an absolute path`);
  const info = await stat(file);
  if (!info.isFile() || info.size > 4096) throw new Error(invalid);
  const value = (await readFile(file, 'utf8')).trim();
  if (!/^[\x21-\x7e]{16,4000}$/.test(value)) throw new Error(invalid);
  return value;
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
