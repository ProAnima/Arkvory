import { lstat, mkdir } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { CliError } from '../errors.js';
import { isMissing } from '../local-files.js';
import { windowsName } from '../mcp/paths.js';

/** Limits of one tree, the same as the server's table of contents (ADR 0083, N8). */
export const TREE_LIMITS = { entries: 100_000, pathLength: 1024, depth: 64 } as const;

/**
 * The path of a tree entry, `/`-separated and relative. Anything that could leave the root —
 * an absolute path, a drive, a backslash, an empty, `.` or `..` segment — is
 * `path_outside_root`; a segment Windows cannot hold as an ordinary file (a device name, `:`,
 * `<>"|?*`, a control character, a trailing dot or space) is `unsafe_name` on every system, so
 * a tree means the same everywhere. The message never repeats the refused text.
 */
export function treePath(raw: string): string {
  if (
    raw.length === 0 ||
    raw.length > TREE_LIMITS.pathLength ||
    raw.startsWith('/') ||
    raw.includes('\\') ||
    raw.includes('\0') ||
    /^[A-Za-z]:/.test(raw)
  )
    throw new CliError('path_outside_root', 5);
  const segments = raw.split('/');
  if (segments.length > TREE_LIMITS.depth) throw new CliError('unsafe_name', 5);
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..')
      throw new CliError('path_outside_root', 5);
    if (!windowsName(segment)) throw new CliError('unsafe_name', 5);
  }
  return raw;
}

/**
 * The name two paths share on a file system that ignores case (Windows, macOS) or Unicode
 * normalization (macOS): NFC, then each character folded through its upper case when that is
 * one character (`ſ` and `s`, `ı` and `i` are one name on Windows), else its lower case. The
 * server's table of contents folds paths the same way (`treePathKey`, ADR 0083, N8).
 */
export function foldTreePath(path: string): string {
  let folded = '';
  for (const char of path.normalize('NFC')) {
    const upper = char.toUpperCase();
    folded += /^.$/su.test(upper) ? upper.toLowerCase() : char.toLowerCase();
  }
  return folded.normalize('NFC');
}

/**
 * Every path of one tree: a second entry with the same path is `duplicate_entry`; paths equal
 * by `foldTreePath` (one file on Windows or macOS), or a file that is also the directory of
 * another entry, are `case_collision`.
 */
export class TreeNames {
  readonly #files = new Set<string>();
  readonly #exact = new Set<string>();
  readonly #directories = new Map<string, string>();

  add(path: string): void {
    const segments = path.split('/');
    for (let depth = 1; depth < segments.length; depth++) {
      const directory = segments.slice(0, depth).join('/');
      const folded = foldTreePath(directory);
      const spelling = this.#directories.get(folded);
      if (this.#files.has(folded) || (spelling !== undefined && spelling !== directory))
        throw new CliError('case_collision', 5);
      this.#directories.set(folded, directory);
    }
    const folded = foldTreePath(path);
    if (this.#files.has(folded) || this.#directories.has(folded))
      throw new CliError(this.#exact.has(path) ? 'duplicate_entry' : 'case_collision', 5);
    if (this.#files.size >= TREE_LIMITS.entries) throw new CliError('too_many_entries', 5);
    this.#files.add(folded);
    this.#exact.add(path);
  }
}

/**
 * The absolute place of `path` under `root`, creating missing directories. Every existing
 * component must be a real directory: a link there could lead the write outside the root, so
 * it is `path_outside_root` (the link is never followed or replaced).
 */
export async function placeInside(
  root: string,
  path: string,
  create: boolean,
): Promise<{ readonly file: string; readonly parent: string }> {
  const segments = treePath(path).split('/');
  let parent = root;
  for (const segment of segments.slice(0, -1)) {
    parent = join(parent, segment);
    try {
      const info = await lstat(parent);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new CliError('path_outside_root', 5);
    } catch (error) {
      if (!isMissing(error)) throw error;
      if (!create) return { file: join(parent, ...segments.slice(-1)), parent };
      await mkdir(parent, { mode: 0o755 });
    }
  }
  return { file: join(parent, segments.at(-1) ?? ''), parent };
}

/** The `/`-separated tree path of an absolute path under `root`. */
export function relativeTreePath(root: string, path: string): string {
  return path
    .slice(root.length + 1)
    .split(sep)
    .join('/');
}
