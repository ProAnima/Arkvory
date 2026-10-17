import { lstat, realpath, stat } from 'node:fs/promises';
import type { BigIntStats } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { CliError } from '../errors.js';
import { isMissing } from '../local-files.js';

/** `--root` as its real path; it must be an existing directory. */
export async function rootDirectory(value: string): Promise<string> {
  let real;
  try {
    real = await realpath(resolve(value));
  } catch {
    throw new CliError('invalid_root');
  }
  if (!(await stat(real)).isDirectory()) throw new CliError('invalid_root');
  return real;
}

/** Whether `path` lies below `root`; both must be absolute and resolved. */
export function below(root: string, path: string): boolean {
  const rest = relative(root, path);
  return rest !== '' && rest !== '..' && !rest.startsWith(`..${sep}`) && !isAbsolute(rest);
}

// Names Windows maps to devices whatever the extension, and characters it does not allow.
const deviceName = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)$/i;
const forbidden = /[<>:"|?*]/;

/**
 * Whether one path segment names an ordinary file on Windows. Node reaches the file system with
 * `\\?\` paths, so it would create `NUL`, `a.txt.` or `a.txt:stream` (an alternate data stream)
 * literally; most Windows programs then cannot open or delete such a file.
 */
export function windowsName(segment: string): boolean {
  const stem = segment.split('.')[0]?.trimEnd() ?? '';
  const control = Array.from(segment).some((char) => char.charCodeAt(0) < 32);
  return !deviceName.test(stem) && !forbidden.test(segment) && !control && !/[ .]$/.test(segment);
}

export interface LocalTarget {
  /** Absolute path in the real parent directory. */
  readonly path: string;
  /** The same path relative to the root, with `/` separators, for results. */
  readonly shown: string;
  readonly exists: boolean;
}

/**
 * Where a download may write. The requested path is taken relative to the root; after
 * normalization it must stay below it, and its parent directory, with every link resolved, too.
 * An existing target must be a regular file or a link to one inside the root; a link leading out,
 * a directory, a device or a FIFO is refused as `path_outside_root`. On Windows a device name,
 * a stream or a name Windows would trim is `invalid_path`. The download checks the place again
 * once its file is open and before the file takes the target name (`unmoved`).
 */
export async function downloadTarget(root: string, requested: string): Promise<LocalTarget> {
  if (requested.length === 0 || requested.length > 4096 || requested.includes('\0'))
    throw new CliError('invalid_path');
  const lexical = resolve(root, requested);
  if (!below(root, lexical)) throw new CliError('path_outside_root');
  if (process.platform === 'win32' && !relative(root, lexical).split(sep).every(windowsName))
    throw new CliError('invalid_path');
  let parent;
  try {
    parent = await realpath(dirname(lexical));
  } catch (error) {
    if (isMissing(error)) throw new CliError('directory_not_found');
    throw error;
  }
  if (parent !== root && !below(root, parent)) throw new CliError('path_outside_root');
  const path = join(parent, basename(lexical));
  let exists = true;
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink()) {
      const target = await realpath(path).catch(() => '');
      if (!target || !below(root, target) || !(await stat(target)).isFile())
        throw new CliError('path_outside_root');
    } else if (!info.isFile()) throw new CliError('path_outside_root');
  } catch (error) {
    if (!isMissing(error)) throw error;
    exists = false;
  }
  return { path, shown: relative(root, path).split('\\').join('/'), exists };
}

/**
 * The temporary file of a download is still the one that was opened (same device and inode),
 * and its directory still resolves to itself. A directory swapped for a link to elsewhere after
 * `downloadTarget` checked it is refused as `path_outside_root`; without `openat` in Node this
 * narrows the race to the moment between the check and the open, which the second check spans.
 */
export async function unmoved(directory: string, temporary: string, opened: BigIntStats) {
  const [real, now] = await Promise.all([
    realpath(directory),
    lstat(temporary, { bigint: true }),
  ]).catch((error: unknown) => {
    // The directory or the file is gone from where it was opened: the place has changed.
    if (isMissing(error)) throw new CliError('path_outside_root');
    throw error;
  });
  if (real !== directory || !now.isFile() || now.dev !== opened.dev || now.ino !== opened.ino)
    throw new CliError('path_outside_root');
}
