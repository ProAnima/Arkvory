import { open, rename, unlink, mkdir, lstat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CliError } from './errors.js';

export function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
export async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}
/** Configuration/checkpoints are bounded regular files. Symlinks are not accepted. */
export async function readSmall(path: string, maxBytes = 1024 * 1024): Promise<string> {
  const info = await lstat(path);
  if (!info.isFile() || info.size > maxBytes) throw new CliError('invalid_local_file');
  const file = await open(path, 'r');
  try {
    const bytes = Buffer.alloc(maxBytes + 1);
    let size = 0;
    while (size < bytes.length) {
      const result = await file.read(bytes, size, bytes.length - size, size);
      if (result.bytesRead === 0) break;
      size += result.bytesRead;
    }
    if (size > maxBytes) throw new CliError('local_file_too_large');
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size));
  } finally {
    await file.close();
  }
}
export async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readSmall(path)) as unknown;
}
export async function syncDirectory(path: string) {
  // Windows does not expose directory fsync through Node; file contents are still flushed.
  if (process.platform === 'win32') return;
  const file = await open(path, 'r');
  try {
    await file.sync();
  } finally {
    await file.close();
  }
}
export async function saveJson(path: string, value: unknown) {
  const temporary = path + '.' + randomUUID() + '.tmp';
  const file = await open(temporary, 'wx', 0o600);
  try {
    await file.writeFile(JSON.stringify(value, null, 2) + '\n');
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await rename(temporary, path);
    await syncDirectory(dirname(path));
  } finally {
    await unlink(temporary).catch((error: unknown) => {
      if (!isMissing(error)) throw error;
    });
  }
}
/** Fail closed after an unclean process death. Never steal another client's transfer lock. */
export async function exclusive<T>(path: string, action: () => Promise<T>): Promise<T> {
  let file;
  try {
    file = await open(path + '.lock', 'wx', 0o600);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST')
      throw new CliError('state_locked', 6);
    throw error;
  }
  try {
    await file.writeFile(JSON.stringify({ pid: process.pid }));
    return await action();
  } finally {
    await file.close();
    await unlink(path + '.lock');
  }
}
export async function privateDirectory(path: string) {
  await mkdir(path, { recursive: true, mode: 0o700 });
}
