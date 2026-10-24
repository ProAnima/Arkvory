import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { requireAssetPath } from '@proanima/arkvory-domain';
import { ModuleServiceError } from '@proanima/arkvory-extension-api';
import { hasCode } from './fs-durability.js';

/** Names Windows maps to devices in any folder, with any extension. */
const DEVICE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9]|conin\$|conout\$)(\..*)?$/i;

/**
 * A file name of a module's data area (ADR 0083, N6): the asset path rules (no `..`, no
 * absolute path, no backslash or colon, no empty segment) and no segment Windows would alias
 * (a device name, a trailing dot or space). Anything else is `invalid_input`.
 */
export function requireDataName(name: string): string[] {
  try {
    requireAssetPath(name);
  } catch {
    throw new ModuleServiceError('invalid_input', 'Invalid data file name');
  }
  const segments = name.split('/');
  if (segments.some((s) => DEVICE.test(s) || s.endsWith('.') || s.endsWith(' ') || s.length > 255))
    throw new ModuleServiceError('invalid_input', 'Invalid data file name');
  return segments;
}

/** What is at `path` without following a link; null when nothing is. */
export async function entryAt(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if (hasCode(error, 'ENOENT') || hasCode(error, 'ENOTDIR')) return null;
    throw error;
  }
}

/**
 * Refuses a name that passes through a link or a non-folder: the port never makes links, so one
 * was put there behind it and would lead outside the area. Checked before each use; the module
 * itself cannot create a link through the port between the check and the use.
 */
export async function requireInside(area: string, segments: readonly string[]): Promise<void> {
  let path = area;
  for (const [index, segment] of segments.entries()) {
    path = join(path, segment);
    const entry = await entryAt(path);
    if (entry === null) return;
    const last = index === segments.length - 1;
    if (entry.isSymbolicLink() || (!last && !entry.isDirectory()))
      throw new ModuleServiceError('invalid_input', 'Data file name passes through a link');
  }
}

/**
 * Regular files under `folder` as names relative to `area` with `/`, in byte order, after
 * `after`, at most `limit`. Links and other entries are skipped, never followed. The walk covers
 * only matching subtrees beyond the cursor and stops as soon as the page is full.
 */
export async function listFiles(
  area: string,
  folder: readonly string[],
  prefix: string,
  after: string | null,
  limit: number,
): Promise<string[]> {
  const found: string[] = [];
  const walk = async (segments: readonly string[]): Promise<void> => {
    let entries;
    try {
      entries = await readdir(join(area, ...segments), { withFileTypes: true });
    } catch (error) {
      if (hasCode(error, 'ENOENT') || hasCode(error, 'ENOTDIR')) return;
      throw error;
    }
    // Sort directories by their name INCLUDING the separator: `a-` precedes `a/`.
    // A sorted depth-first walk then has the same order as sorting all complete names.
    const key = (entry: (typeof entries)[number]) => entry.name + (entry.isDirectory() ? '/' : '');
    entries.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
    for (const entry of entries) {
      if (found.length >= limit) return;
      const relative = [...segments, entry.name].join('/');
      if (entry.isDirectory()) {
        const subtree = relative + '/';
        if (!subtree.startsWith(prefix) && !prefix.startsWith(subtree)) continue;
        if (after !== null && after >= subtree && !after.startsWith(subtree)) continue;
        await walk([...segments, entry.name]);
      } else if (
        entry.isFile() &&
        relative.startsWith(prefix) &&
        (after === null || relative > after)
      )
        found.push(relative);
    }
  };
  await walk(folder);
  return found;
}

/** Bytes and regular files under `path`, for the bounded reconciliation with the disk. */
export async function measureTree(
  path: string,
  signal?: AbortSignal,
): Promise<{ bytes: number; files: number }> {
  let bytes = 0;
  let files = 0;
  const pending: Promise<void>[] = [];
  const drain = async () => {
    const results = await Promise.allSettled(pending);
    pending.length = 0;
    for (const result of results) if (result.status === 'rejected') throw result.reason;
    signal?.throwIfAborted();
  };
  const walk = async (folder: string): Promise<void> => {
    signal?.throwIfAborted();
    let entries;
    try {
      entries = await readdir(folder, { withFileTypes: true });
    } catch (error) {
      if (hasCode(error, 'ENOENT')) return;
      throw error;
    }
    for (const entry of entries) {
      signal?.throwIfAborted();
      const child = join(folder, entry.name);
      if (entry.isDirectory()) {
        await drain();
        await walk(child);
      } else if (entry.isFile()) {
        pending.push(
          (async () => {
            const measured = await lstat(child);
            signal?.throwIfAborted();
            files++;
            bytes += measured.size;
          })(),
        );
        if (pending.length === 8) await drain();
      }
    }
    await drain();
  };
  try {
    // The caller still holds the quota/admission lock for the complete walk. Only independent
    // stats overlap; cancellation/failure drains them before that lock can be released.
    await walk(path);
  } catch (error) {
    await Promise.allSettled(pending);
    throw error;
  }
  return { bytes, files };
}
