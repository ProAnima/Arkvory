import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, rename, rm, rmdir, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { CliError } from '../errors.js';
import { isMissing } from '../local-files.js';
import { localDigest, localPaths, localSize, writeTreeFile } from './local-tree.js';
import { placeInside } from './tree-paths.js';
import type { SourceEntry, TreeSource } from './tree-source.js';

/** How a local directory differs from the published tree. Lists are capped for output. */
export interface TreeReport {
  readonly mode: TreeSource['mode'];
  readonly entries: number;
  readonly missing: readonly string[];
  readonly mismatched: readonly string[];
  /** Local paths the tree does not have (files, links, special files). */
  readonly extra: readonly string[];
}

const SHOWN = 1000;
const cap = (paths: readonly string[]) => paths.slice(0, SHOWN);

/** Compares every entry with its local file: size first, then SHA-256. */
export async function compareTree(
  source: TreeSource,
  root: string,
  signal: AbortSignal,
): Promise<{ report: TreeReport; differing: readonly SourceEntry[] }> {
  const missing: string[] = [];
  const mismatched: string[] = [];
  const differing: SourceEntry[] = [];
  for (const entry of source.entries) {
    signal.throwIfAborted();
    const size = await localSize(root, entry.path);
    if (size === null) {
      missing.push(entry.path);
      differing.push(entry);
      continue;
    }
    const local = size === entry.size ? await localDigest(root, entry.path, signal) : null;
    if (local === null || local.sha256 !== (await source.digest(entry, signal))) {
      mismatched.push(entry.path);
      differing.push(entry);
    }
  }
  const known = new Set(source.entries.map((entry) => entry.path));
  const { paths } = await localPaths(root, signal);
  const extra = paths.filter((path) => !known.has(path));
  return {
    report: { mode: source.mode, entries: source.entries.length, missing, mismatched, extra },
    differing,
  };
}

/** The mode a rewritten file gets: the archive's, else the local file's, else 0644. */
async function modeOf(root: string, entry: SourceEntry): Promise<number> {
  if (entry.mode !== null) return entry.mode;
  try {
    const info = await lstat((await placeInside(root, entry.path, false)).file);
    return info.isFile() && info.mode & 0o100 ? 0o755 : 0o644;
  } catch {
    return 0o644;
  }
}

/** Writes the given entries from the source through the verifying writer. */
export async function writeEntries(
  source: TreeSource,
  root: string,
  entries: readonly SourceEntry[],
  signal: AbortSignal,
): Promise<void> {
  for (const entry of entries) {
    signal.throwIfAborted();
    await writeTreeFile(
      root,
      entry.path,
      source.content(entry, signal),
      {
        size: entry.size,
        sha256: entry.sha256,
        crc32: entry.sha256 === null ? entry.crc32 : null,
        mode: await modeOf(root, entry),
      },
      signal,
    );
  }
}

/**
 * `tree repair`: every missing or differing file is written again from the source; with a
 * table of contents only those entries' ranges are fetched (T2). Extra local files are kept
 * and reported; our leftover temporary files are removed.
 */
export async function repairTree(source: TreeSource, root: string, signal: AbortSignal) {
  const { report, differing } = await compareTree(source, root, signal);
  await writeEntries(source, root, differing, signal);
  for (const file of (await localPaths(root, signal)).temporary)
    await unlink(file).catch(() => undefined);
  return {
    ...shown(report),
    repaired: differing.length,
    fetchedBytes: String(source.fetched()),
  };
}

export function shown(report: TreeReport) {
  return {
    mode: report.mode,
    entries: report.entries,
    ok: report.missing.length === 0 && report.mismatched.length === 0,
    missing: cap(report.missing),
    mismatched: cap(report.mismatched),
    extra: cap(report.extra),
    counts: {
      missing: report.missing.length,
      mismatched: report.mismatched.length,
      extra: report.extra.length,
    },
  };
}

/**
 * `tree pull` into a directory that holds files, with a table of contents (T2): the directory
 * becomes the tree — differing files are fetched by range and replaced one by one, extra files
 * are removed (a link is removed itself, never what it points to). Directories stay.
 */
export async function syncTree(source: TreeSource, root: string, signal: AbortSignal) {
  const { report, differing } = await compareTree(source, root, signal);
  // Extra files first: one of them may stand where an entry needs a directory.
  for (const path of report.extra) await unlink(join(root, ...path.split('/')));
  await writeEntries(source, root, differing, signal);
  for (const file of (await localPaths(root, signal)).temporary)
    await unlink(file).catch(() => undefined);
  return {
    mode: source.mode,
    entries: report.entries,
    repaired: differing.length,
    removed: report.extra.length,
    fetchedBytes: String(source.fetched()),
  };
}

/** Whether `root` is missing or an empty directory; anything else that is not a directory fails. */
export async function emptyTarget(root: string): Promise<boolean> {
  try {
    const info = await lstat(root);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new CliError('path_conflict', 6);
    return (await readdir(root)).length === 0;
  } catch (error) {
    if (isMissing(error)) return true;
    throw error;
  }
}

/**
 * `tree pull` from the whole archive (T1): every file is extracted through the verifying writer
 * into a new directory beside the target, which then takes the target's place. A target that
 * held files is first moved aside and removed only after the swap, so a failure leaves either
 * the old tree or the new one at the target (and at worst the old one beside it).
 */
export async function extractTree(source: TreeSource, root: string, signal: AbortSignal) {
  const staging = join(dirname(root), `.${basename(root)}.arkvory-pull-${randomUUID()}`);
  await mkdir(staging, { mode: 0o755 });
  try {
    await writeEntries(source, staging, source.entries, signal);
    signal.throwIfAborted();
    let previous: string | null = null;
    if (!(await emptyTarget(root))) {
      previous = join(dirname(root), `.${basename(root)}.arkvory-old-${randomUUID()}`);
      await rename(root, previous);
    } else
      await rmdir(root).catch((error: unknown) => {
        if (!isMissing(error)) throw error;
      });
    await rename(staging, root);
    if (previous !== null) await rm(previous, { recursive: true, force: true });
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  return {
    mode: source.mode,
    entries: source.entries.length,
    fetchedBytes: String(source.fetched()),
  };
}
