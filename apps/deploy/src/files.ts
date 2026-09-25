import { open, mkdir, readFile, rename, unlink, lstat } from 'node:fs/promises';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';

export function inside(root: string, ...parts: string[]): string {
  const path = resolve(root, ...parts);
  const delta = relative(resolve(root), path);
  if (!delta || delta.startsWith('..') || isAbsolute(delta))
    throw new Error('Path must remain inside installation');
  return path;
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
  // POSIX directory fsync makes pointer replacement durable. Windows does not expose directory fsync.
  if (process.platform !== 'win32') {
    const directory = await open(dirname(path), 'r');
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
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    await lock.sync();
    return await work();
  } finally {
    await lock.close();
    await unlink(path);
  }
}
