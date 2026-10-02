import { realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { BackupFailure } from '@proanima/arkvory-domain';
import { hasCode } from './fs-durability.js';

/**
 * Canonical location of a path that may not exist yet: the nearest existing ancestor is
 * resolved through symlinks, junctions and 8.3 aliases, the missing tail is appended.
 */
export async function canonicalPath(path: string): Promise<string> {
  const absolute = resolve(path);
  try {
    return await realpath(absolute);
  } catch (error) {
    if (!hasCode(error, 'ENOENT')) throw error;
    const parent = dirname(absolute);
    if (parent === absolute) throw error;
    return join(await canonicalPath(parent), basename(absolute));
  }
}

/** True when `inner` equals `outer` or lies below it (case-insensitive on Windows). */
export function containsPath(outer: string, inner: string): boolean {
  const path = relative(outer, inner);
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith('..' + sep));
}

/**
 * Refuses overlapping locations: a vault inside the storage root (or the reverse) would be
 * lost together with it, and a restore target inside a vault would mix the two trees.
 */
export async function requireSeparateTrees(
  first: { readonly label: string; readonly path: string },
  second: { readonly label: string; readonly path: string },
): Promise<void> {
  const [a, b] = await Promise.all([canonicalPath(first.path), canonicalPath(second.path)]);
  if (containsPath(a, b) || containsPath(b, a))
    throw new BackupFailure(
      'unsafe_path',
      `The ${first.label} and the ${second.label} must not contain each other`,
    );
}
