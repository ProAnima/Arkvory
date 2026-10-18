import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, lstat, open, readdir, rename, unlink } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { crc32 } from 'node:zlib';
import { CliError } from '../errors.js';
import { isMissing, syncDirectory } from '../local-files.js';
import { placeInside, relativeTreePath } from './tree-paths.js';

/** What a written file must be; SHA-256 when known (table of contents), CRC-32 otherwise. */
export interface ExpectedFile {
  readonly size: number;
  readonly sha256: string | null;
  readonly crc32: number | null;
  readonly mode: number;
}

/** Our temporary files: `.<name>.arkvory-<uuid>.tmp` beside their target. */
export const TEMPORARY = /^\..+\.arkvory-[0-9a-f-]{36}\.tmp$/;

/**
 * Writes one file of a tree the core way (ADR 0083, N8, `LocalTreeWriter`): into a temporary
 * file beside the target, hashing as it goes; only when size and SHA-256 (or CRC-32 without a
 * table of contents) match is it synced and renamed over the target in one step. Otherwise it
 * is `checksum_mismatch` and the target is unchanged — so neither a transfer extension nor a
 * damaged range can leave a file that differs from the published tree. The place is inside
 * the root by the tree rules; a link on the way is `path_outside_root`, a directory at the
 * target `path_conflict`.
 */
export async function writeTreeFile(
  root: string,
  path: string,
  content: AsyncIterable<Uint8Array>,
  expected: ExpectedFile,
  signal: AbortSignal,
): Promise<void> {
  const { file, parent } = await placeInside(root, path, true);
  try {
    if ((await lstat(file)).isDirectory()) throw new CliError('path_conflict', 6);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  const temporary = join(parent, `.${basename(file)}.arkvory-${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx', 0o600);
  let renamed = false;
  try {
    const hash = createHash('sha256');
    let crc = 0;
    let size = 0;
    for await (const chunk of content) {
      signal.throwIfAborted();
      size += chunk.length;
      if (size > expected.size) throw new CliError('checksum_mismatch', 5);
      hash.update(chunk);
      if (expected.crc32 !== null) crc = crc32(chunk, crc);
      let done = 0;
      while (done < chunk.length) {
        const { bytesWritten } = await handle.write(chunk, done, chunk.length - done);
        if (bytesWritten === 0) throw new CliError('disk_write_failed', 7);
        done += bytesWritten;
      }
    }
    if (
      size !== expected.size ||
      (expected.sha256 !== null && hash.digest('hex') !== expected.sha256) ||
      (expected.crc32 !== null && crc >>> 0 !== expected.crc32 >>> 0)
    )
      throw new CliError('checksum_mismatch', 5);
    await handle.sync();
    await handle.close();
    if (process.platform !== 'win32')
      await chmod(temporary, expected.mode === 0o755 ? 0o755 : 0o644);
    await rename(temporary, file);
    renamed = true;
    await syncDirectory(parent);
  } finally {
    await handle.close().catch(() => undefined);
    if (!renamed) await unlink(temporary).catch(() => undefined);
  }
}

/** Size and SHA-256 of a regular file; null when it is missing or not a regular file. */
export async function localDigest(
  root: string,
  path: string,
  signal: AbortSignal,
): Promise<{ readonly size: number; readonly sha256: string } | null> {
  let file: string;
  try {
    file = (await placeInside(root, path, false)).file;
    const info = await lstat(file);
    if (!info.isFile()) return null;
  } catch (error) {
    if (isMissing(error) || (error instanceof CliError && error.code === 'path_outside_root'))
      return null;
    throw error;
  }
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of createReadStream(file, { highWaterMark: 1024 * 1024, signal })) {
    if (!(chunk instanceof Uint8Array)) throw new CliError('invalid_file_stream', 7);
    size += chunk.length;
    hash.update(chunk);
  }
  return { size, sha256: hash.digest('hex') };
}

/** Whether the local file can match an entry of `size` without hashing it. */
export async function localSize(root: string, path: string): Promise<number | null> {
  try {
    const info = await lstat((await placeInside(root, path, false)).file);
    return info.isFile() ? info.size : null;
  } catch (error) {
    if (isMissing(error) || (error instanceof CliError && error.code === 'path_outside_root'))
      return null;
    throw error;
  }
}

/**
 * Every path under `root` that is not a directory, without following links: regular files,
 * links and special files alike (the caller decides what is extra). Our own leftover temporary
 * files are listed separately.
 */
export async function localPaths(
  root: string,
  signal: AbortSignal,
): Promise<{ readonly paths: readonly string[]; readonly temporary: readonly string[] }> {
  const paths: string[] = [];
  const temporary: string[] = [];
  const pending = [root];
  while (pending.length) {
    signal.throwIfAborted();
    const directory = pending.pop() ?? root;
    let items;
    try {
      items = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      // A target that does not exist yet holds nothing.
      if (directory === root && isMissing(error)) break;
      throw error;
    }
    for (const item of items) {
      const absolute = join(directory, item.name);
      if (item.isDirectory()) pending.push(absolute);
      else if (item.isFile() && TEMPORARY.test(item.name)) temporary.push(absolute);
      else paths.push(relativeTreePath(root, absolute));
    }
  }
  return { paths: paths.sort(), temporary };
}
