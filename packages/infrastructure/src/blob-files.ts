import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { link, open, rename, stat, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { ArkvoryError } from '@proanima/arkvory-domain';
import type { ArtifactDescriptor } from '@proanima/arkvory-domain';
import type { Cancellation } from '@proanima/arkvory-application';
import { hasCode, syncDirectory } from './fs-durability.js';

/** Chunk of internal copies and checks: fewer reads and hash calls than response chunks. */
export const internalChunkBytes = 1024 * 1024;

/**
 * Content already written to a file on the data volume by a staging area (ADR 0074). The store
 * can adopt the file as the blob instead of copying it. `measured` is the size and SHA-256 the
 * staging area computed while it wrote the file; without it the store hashes the file once.
 */
export interface StagedFile extends AsyncIterable<Uint8Array> {
  readonly stagedPath: string;
  readonly measured?: { readonly size: number; readonly sha256: string };
}

export function stagedFile(
  stagedPath: string,
  bytes: () => AsyncIterable<Uint8Array>,
  measured?: { readonly size: number; readonly sha256: string },
): StagedFile {
  return {
    stagedPath,
    ...(measured ? { measured } : {}),
    [Symbol.asyncIterator]: () => bytes()[Symbol.asyncIterator](),
  };
}

export function stagedFileOf(source: AsyncIterable<Uint8Array>): StagedFile | null {
  const candidate = source as Partial<StagedFile>;
  return typeof candidate.stagedPath === 'string' ? (source as StagedFile) : null;
}

/**
 * A stored file read in chunks (64 KiB for responses, which the bandwidth governor paces; 1 MiB
 * for internal copies and checks). Ending before its declared size is an integrity error.
 */
export async function* streamFile(
  path: string,
  size: number,
  range?: { start: number; end: number },
  chunkBytes = 64 * 1024,
): AsyncIterable<Uint8Array> {
  if (size === 0) return;
  const stream = createReadStream(path, {
    start: range?.start ?? 0,
    end: range?.end ?? size - 1,
    highWaterMark: chunkBytes,
  });
  let remaining = range ? range.end - range.start + 1 : size;
  for await (const chunk of stream) {
    if (!(chunk instanceof Uint8Array))
      throw new ArkvoryError('unavailable', 'Invalid content stream');
    remaining -= chunk.byteLength;
    yield chunk;
  }
  // A file can be truncated after the metadata/stat check. Never report a successful short EOF.
  if (remaining !== 0)
    throw new ArkvoryError('integrity_mismatch', 'Stored content ended before its declared size');
}

/** Size and SHA-256 of a stored file against its descriptor, then its directory synced. */
export async function verifyFile(
  path: string,
  expected: ArtifactDescriptor,
  cancellation: Cancellation,
): Promise<void> {
  const info = await stat(path);
  if (info.size !== expected.size)
    throw new ArkvoryError('integrity_mismatch', 'Stored size mismatch');
  const hash = createHash('sha256');
  for await (const chunk of streamFile(path, expected.size, undefined, internalChunkBytes)) {
    cancellation.throwIfAborted();
    hash.update(chunk);
  }
  cancellation.throwIfAborted();
  if (hash.digest('hex') !== expected.sha256)
    throw new ArkvoryError('integrity_mismatch', 'Stored content failed integrity verification');
  await syncDirectory(dirname(path));
}

/**
 * A staged file on this volume becomes the blob by a second directory entry, not a copy
 * (ADR 0074). Its bytes are trusted only with the size and SHA-256 its staging area measured
 * while writing them; otherwise they are hashed once here. The file is synced before it
 * becomes visible. Returns false when the file is elsewhere (another volume, or none): then it
 * is copied.
 *
 * First the staged name moves to a private one, so nothing that opens the staged name later
 * (a retried append, say) reaches the published bytes: it finds no file, or a new one. The
 * private name is removed once the blob holds the file; when adoption fails before that, the
 * file returns to the staged name unless a new file took it meanwhile.
 */
export async function adoptStagedFile(
  staged: StagedFile,
  expected: ArtifactDescriptor,
  target: string,
  cancellation: Cancellation,
): Promise<boolean> {
  let file;
  try {
    file = await stat(staged.stagedPath);
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return false;
    throw error;
  }
  if (!file.isFile() || file.dev !== (await stat(dirname(target))).dev) return false;
  const claimed = `${staged.stagedPath}.adopting-${randomUUID()}`;
  try {
    await rename(staged.stagedPath, claimed);
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return false;
    throw error;
  }
  try {
    await adoptClaimed(claimed, staged.measured, expected, target, cancellation);
  } catch (error) {
    await link(claimed, staged.stagedPath).catch(() => undefined);
    await unlink(claimed).catch(() => undefined);
    throw error;
  }
  await unlink(claimed).catch(() => undefined);
  return true;
}

async function adoptClaimed(
  path: string,
  measured: StagedFile['measured'],
  expected: ArtifactDescriptor,
  target: string,
  cancellation: Cancellation,
): Promise<void> {
  const file = await stat(path);
  if (file.size !== expected.size)
    throw new ArkvoryError(
      'integrity_mismatch',
      'Uploaded size or SHA-256 differs from declaration',
    );
  if (!measured) await verifyFile(path, expected, cancellation);
  else if (measured.size !== expected.size || measured.sha256 !== expected.sha256)
    throw new ArkvoryError(
      'integrity_mismatch',
      'Uploaded size or SHA-256 differs from declaration',
    );
  // Write access: Windows flushes a file only through a handle that may write it.
  const handle = await open(path, 'r+');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
  cancellation.throwIfAborted();
  try {
    await link(path, target);
  } catch (error) {
    if (!hasCode(error, 'EEXIST')) throw error;
    await verifyFile(target, expected, cancellation);
  }
  await syncDirectory(dirname(target));
}
