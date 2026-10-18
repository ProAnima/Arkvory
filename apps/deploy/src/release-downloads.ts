import { randomUUID } from 'node:crypto';
import { lstat, readdir, unlink } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { inside } from './files.js';
import { report } from './output.js';

/** Release archives downloaded into the installation root: `download-<uuid>.zip`, nothing else. */
const DOWNLOAD = /^download-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.zip$/;

const missing = (error: unknown) =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT';

/** A new download path in the root; stage() removes it when it is done with the archive. */
export const downloadPath = (root: string) => inside(root, `download-${randomUUID()}.zip`);

/** Whether `path` is a download of the root, as opposed to an operator's local artifact. */
const isDownload = (root: string, path: string) =>
  dirname(resolve(path)) === resolve(root) && DOWNLOAD.test(basename(path));

/**
 * Removes the archive when stage() downloaded it into the root; a local artifact stays. A file
 * that cannot be removed yet (antivirus on Windows) is reported and left to the next operation,
 * so cleanup never hides the result of the stage.
 */
export async function discardDownload(root: string, path: string): Promise<void> {
  if (!isDownload(root, path)) return;
  try {
    await unlink(path);
  } catch (error) {
    if (!missing(error))
      report('warning', `Cannot remove downloaded archive ${basename(path)} yet`);
  }
}

/**
 * Removes downloads that an interrupted operation left in the root: regular files with the
 * download name, last changed before `before` (the start of this operation, which holds the
 * operation lock). Links and other entries are never followed or removed.
 */
export async function removeStaleDownloads(root: string, before: number): Promise<void> {
  let names: string[];
  try {
    names = await readdir(root);
  } catch (error) {
    if (missing(error)) return;
    throw error;
  }
  for (const name of names.filter((entry) => DOWNLOAD.test(entry))) {
    const path = inside(root, name);
    try {
      const info = await lstat(path);
      if (info.isFile() && info.mtimeMs < before) await unlink(path);
    } catch (error) {
      if (!missing(error)) report('warning', `Cannot remove stale archive ${name} yet`);
    }
  }
}
