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
 * the folder of the prefix; its size is bounded by the module's file quota.
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
    for (const entry of entries) {
      const relative = [...segments, entry.name].join('/');
      if (entry.isDirectory()) await walk([...segments, entry.name]);
      else if (entry.isFile() && relative.startsWith(prefix)) found.push(relative);
    }
  };
  await walk(folder);
  // Byte order of whole names, which a depth-first walk does not give ('-' sorts before '/').
  return found
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .filter((name) => after === null || name > after)
    .slice(0, limit);
}

/** Bytes and regular files under `path`, for the bounded reconciliation with the disk. */
export async function measureTree(path: string): Promise<{ bytes: number; files: number }> {
  let bytes = 0;
  let files = 0;
  const walk = async (folder: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(folder, { withFileTypes: true });
    } catch (error) {
      if (hasCode(error, 'ENOENT')) return;
      throw error;
    }
    for (const entry of entries) {
      const child = join(folder, entry.name);
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile()) {
        files++;
        bytes += (await lstat(child)).size;
      }
    }
  };
  await walk(path);
  return { bytes, files };
}
