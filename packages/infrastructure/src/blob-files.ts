import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { ArkvoryError } from '@proanima/arkvory-domain';
import type { ArtifactDescriptor } from '@proanima/arkvory-domain';
import type { Cancellation } from '@proanima/arkvory-application';
import { syncDirectory } from './fs-durability.js';

/** A stored file read in 64 KiB chunks; ending before its declared size is an integrity error. */
export async function* streamFile(
  path: string,
  size: number,
  range?: { start: number; end: number },
): AsyncIterable<Uint8Array> {
  if (size === 0) return;
  const stream = createReadStream(path, {
    start: range?.start ?? 0,
    end: range?.end ?? size - 1,
    highWaterMark: 64 * 1024,
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
  for await (const chunk of streamFile(path, expected.size)) {
    cancellation.throwIfAborted();
    hash.update(chunk);
  }
  cancellation.throwIfAborted();
  if (hash.digest('hex') !== expected.sha256)
    throw new ArkvoryError('integrity_mismatch', 'Stored content failed integrity verification');
  await syncDirectory(dirname(path));
}
