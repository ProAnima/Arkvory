import { lstat, realpath, stat } from 'node:fs/promises';
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
 * a directory, a device or a FIFO is refused as `path_outside_root`. The check runs right before
 * the write; a local process that swaps a directory for a link in between is outside this
 * boundary, as for any program the user runs.
 */
export async function downloadTarget(root: string, requested: string): Promise<LocalTarget> {
  if (requested.length === 0 || requested.length > 4096 || requested.includes('\0'))
    throw new CliError('invalid_path');
  const lexical = resolve(root, requested);
  if (!below(root, lexical)) throw new CliError('path_outside_root');
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
