import { randomUUID } from 'node:crypto';
import { link, open, readdir, stat, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { syncDirectory } from './files.js';

/** The marker a volume of the storage module carries; the services only read it. */
const MARKER = 'storage-id';
/** What a new, empty file system may already hold: ext2/3/4 create `lost+found`. */
const NEW_FILE_SYSTEM = new Set(['lost+found']);

export interface VolumeInitOptions {
  readonly directory: string;
  /**
   * The directory must be the mount point of its own file system: its device differs from its
   * parent's. On by default on Linux; `--no-expect-mount` for a directory inside a mounted volume.
   */
  readonly expectMount: boolean;
  /** File system of a path (tests); `stat().dev` otherwise. */
  readonly device?: (path: string) => Promise<bigint>;
}

/** `--expect-mount` unless `--no-expect-mount`; the default holds on Linux only. */
export function expectMount(options: ReadonlyMap<string, string>, platform = process.platform) {
  if (options.has('expect-mount') && options.has('no-expect-mount'))
    throw new Error('Choose one of --expect-mount and --no-expect-mount');
  if (options.has('expect-mount')) return true;
  if (options.has('no-expect-mount')) return false;
  return platform === 'linux';
}

/**
 * Marks an empty directory as a new storage volume (ADR 0083, N11): writes its identity file
 * `storage-id` once, synced, through a link that never replaces an existing one. The services
 * never create this file: a configured volume without it stays unavailable, so the empty mount
 * point of a volume that is not mounted is never taken for a new volume. The API records the
 * identity and creates the layout inside the directory at its next start.
 */
export async function initializeVolume(options: VolumeInitOptions): Promise<string> {
  if (!isAbsolute(options.directory)) throw new Error('--directory must be an absolute path');
  const root = resolve(options.directory);
  const info = await stat(root).catch(() => null);
  if (!info?.isDirectory())
    throw new Error('The volume directory does not exist: mount the volume and create it first');
  const entries = await readdir(root);
  if (entries.includes(MARKER)) throw new Error('The volume is already initialized');
  if (entries.some((entry) => !NEW_FILE_SYSTEM.has(entry)))
    throw new Error('The volume directory is not empty');
  if (options.expectMount) {
    const device = options.device ?? (async (path) => (await stat(path, { bigint: true })).dev);
    const parent = dirname(root);
    if (parent === root || (await device(root)) === (await device(parent)))
      throw new Error(
        'The volume directory is not a mount point: mount the volume first, or pass --no-expect-mount for a directory inside a mounted volume',
      );
  }
  const identity = randomUUID();
  const temporary = join(root, `.${MARKER}-${randomUUID()}`);
  const file = await open(temporary, 'wx', 0o644);
  try {
    try {
      await file.writeFile(identity);
      // The services run as the owner of the directory: the marker is theirs too.
      if (process.platform !== 'win32') await file.chown(info.uid, info.gid);
      await file.sync();
    } finally {
      await file.close();
    }
    try {
      await link(temporary, join(root, MARKER));
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'EEXIST')
        throw new Error('The volume is already initialized', { cause: error });
      throw error;
    }
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
  await syncDirectory(root);
  return identity;
}
