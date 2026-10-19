import { realpath, rm, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { newDownloadId } from '@proanima/arkvory-sdk';
import type { ArkvoryClient, DownloadClass } from '@proanima/arkvory-sdk';
import { option, validateCommand, word } from '../arguments.js';
import type { Arguments } from '../arguments.js';
import { Rendered } from '../backup-commands.js';
import { download } from '../download.js';
import { CliError } from '../errors.js';
import { exclusive, exists, isMissing } from '../local-files.js';
import { upload } from '../upload.js';
import { archiveSource, serverEntries, tocSource } from './tree-source.js';
import type { TreeSource } from './tree-source.js';
import { emptyTarget, extractTree, repairTree, shown, compareTree, syncTree } from './tree-sync.js';
import { treeFiles, writeTreeArchive } from './zip-write.js';

export interface TreeConnection {
  readonly client: ArkvoryClient;
  readonly server: string;
  readonly repository: string;
  readonly downloadClass?: DownloadClass;
}

type Progress = (bytes: number, total: number) => void;

async function directory(value: string): Promise<string> {
  try {
    const real = await realpath(resolve(value));
    if ((await stat(real)).isDirectory() && dirname(real) !== real) return real;
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  throw new CliError('directory_not_found');
}

/** A target directory whose parent exists; the target itself may be missing. */
async function target(value: string): Promise<string> {
  const path = resolve(value);
  if (dirname(path) === path) throw new CliError('path_conflict', 6);
  return join(await directory(dirname(path)), basename(path));
}

/**
 * `tree push DIR [--name NAME.zip] [--label TAG] [--file META.json] [--compress]` (ADR 0083, N8,
 * T1): the directory as one deterministic ZIP (stored entries, fixed timestamps), uploaded in
 * resumable parts with a checkpoint; repeating the command after an interruption packs the same
 * bytes and resumes. The archive and its checkpoint beside the directory go after success.
 */
async function push(
  args: Arguments,
  connected: TreeConnection,
  signal: AbortSignal,
  progress: Progress,
) {
  validateCommand(args, 3, ['name', 'label', 'file', 'compress']);
  const root = await directory(word(args, 2));
  const name = args.options.get('name') ?? `${basename(root)}.zip`;
  // The server builds a table of contents for .zip names only (ADR 0083, N8, T2).
  if (!/^[^/\\]{1,251}\.zip$/i.test(name)) throw new CliError('invalid_tree_name');
  const archive = join(dirname(root), `.${basename(root)}.arkvory-tree.zip`);
  return exclusive(archive, async () => {
    const files = await treeFiles(root, signal);
    await rm(archive, { force: true });
    await writeTreeArchive(files, archive, args.options.has('compress'), signal);
    const state = `${archive}.arkvory-upload.json`;
    const result = await upload({
      ...connected,
      path: archive,
      name,
      state,
      signal,
      progress,
      ...(args.options.has('file') ? { annotations: option(args, 'file') } : {}),
      ...(args.options.has('label') ? { label: option(args, 'label') } : {}),
    });
    await rm(archive, { force: true });
    await rm(state, { force: true });
    return {
      id: result.id,
      name: result.descriptor.name,
      size: result.descriptor.size,
      sha256: result.descriptor.sha256,
      entries: files.length,
    };
  });
}

/**
 * The whole archive, downloaded and verified by the SDK beside the target (resumable like
 * `download`), then opened as a source; `release` removes it.
 */
async function archiveFromServer(
  connected: TreeConnection,
  id: string,
  root: string,
  signal: AbortSignal,
  progress: Progress,
) {
  const file = join(dirname(root), `.${basename(root)}.arkvory-tree.zip`);
  // A finished download left by an interrupted run has no checkpoint: it is fetched again.
  if ((await exists(file)) && !(await exists(`${file}.arkvory-download.json`)))
    await rm(file, { force: true });
  await download({ ...connected, id, output: file, signal, progress });
  const source = await archiveSource(file);
  return {
    source,
    release: async () => {
      await source.close();
      await rm(file, { force: true });
    },
  };
}

async function withSource<T>(
  connected: TreeConnection,
  id: string,
  root: string,
  signal: AbortSignal,
  progress: Progress,
  preferToc: boolean,
  work: (source: TreeSource) => Promise<T>,
): Promise<T> {
  const toc = preferToc
    ? await serverEntries(connected.client, connected.repository, id, signal)
    : null;
  if (toc !== null)
    return work(tocSource(connected.client, connected.repository, id, toc, newDownloadId()));
  const { source, release } = await archiveFromServer(connected, id, root, signal, progress);
  try {
    return await work(source);
  } finally {
    await release();
  }
}

const rendered = (json: Record<string, unknown>, failed: boolean) =>
  new Rendered(json, () => JSON.stringify(json, null, 2), failed ? 5 : 0);

/**
 * `tree push|pull|verify|repair` (ADR 0083, N8): the free baseline `zip-tree` 1. With the
 * server's table of contents (`capabilities.tree`, T2) verify compares every file by SHA-256
 * and repair and pull fetch only differing files by range; without it the whole archive is
 * downloaded and verified (T1). Every written file passes the verifying writer.
 */
export async function treeCommand(
  args: Arguments,
  connected: TreeConnection,
  signal: AbortSignal,
  progress: Progress,
): Promise<unknown> {
  const operation = word(args, 1);
  if (operation === 'push') return push(args, connected, signal, progress);
  validateCommand(args, 4);
  const id = word(args, 2);
  const root = await target(word(args, 3));
  if (operation === 'verify') {
    return withSource(connected, id, root, signal, progress, true, async (source) => {
      const result = shown((await compareTree(source, root, signal)).report);
      return rendered({ artifact: id, path: root, ...result }, !result.ok);
    });
  }
  if (operation === 'repair')
    return withSource(connected, id, root, signal, progress, true, async (source) => ({
      artifact: id,
      path: root,
      ...(await repairTree(source, root, signal)),
    }));
  if (operation !== 'pull') throw new CliError('unknown_command');
  // An empty target always takes the whole archive (variant A); a full one is synchronized.
  const empty = await emptyTarget(root);
  return withSource(connected, id, root, signal, progress, !empty, async (source) => ({
    artifact: id,
    path: root,
    ...(source.mode === 'toc'
      ? await syncTree(source, root, signal)
      : await extractTree(source, root, signal)),
  }));
}
