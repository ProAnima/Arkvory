import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, rename, stat, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { BackupFailure } from '@proanima/arkvory-domain';
import type { PointFile } from '@proanima/arkvory-domain';
import type { Cancellation, FileDigest } from '@proanima/arkvory-application';
import { hasCode, syncDirectory } from './fs-durability.js';

/** The vault holds catalog data and content in plain form (ADR 0054): owner-only access. */
export const VAULT_FILE_MODE = 0o600;
export const VAULT_DIRECTORY_MODE = 0o700;
const writeSlice = 1024 * 1024;
const lineBatch = 64 * 1024;

export interface WriteExpectation {
  readonly size: number;
  readonly sha256: string;
}

/**
 * Streams chunks into a new owner-only temporary file next to `target`, verifies the optional
 * expectation, fsyncs, renames and fsyncs the directory. A reader therefore sees either nothing
 * or the complete verified file. Replacing an existing target is only used for content-addressed
 * blobs, whose verified bytes are identical by construction.
 */
export async function writeDurably(
  target: string,
  chunks: AsyncIterable<Uint8Array>,
  options: { cancellation: Cancellation; expected?: WriteExpectation; countLines?: boolean },
): Promise<FileDigest> {
  const temporary = join(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx', VAULT_FILE_MODE);
  const hash = createHash('sha256');
  let bytes = 0;
  let lines = 0;
  let renamed = false;
  try {
    try {
      for await (const chunk of chunks) {
        options.cancellation.throwIfAborted();
        if (options.expected && bytes + chunk.byteLength > options.expected.size)
          throw new BackupFailure(
            'integrity_mismatch',
            'Content is longer than its inventory size',
          );
        for (let offset = 0; offset < chunk.byteLength;) {
          const { bytesWritten } = await handle.write(
            chunk,
            offset,
            Math.min(chunk.byteLength - offset, writeSlice),
          );
          if (bytesWritten === 0) throw new BackupFailure('unavailable', 'Vault write failed');
          offset += bytesWritten;
        }
        hash.update(chunk);
        bytes += chunk.byteLength;
        if (options.countLines) for (const byte of chunk) if (byte === 10) lines++;
      }
      await handle.sync();
    } finally {
      await handle.close();
    }
    const sha256 = hash.digest('hex');
    if (options.expected && (bytes !== options.expected.size || sha256 !== options.expected.sha256))
      throw new BackupFailure('integrity_mismatch', 'Copied content differs from its inventory');
    options.cancellation.throwIfAborted();
    await rename(temporary, target);
    renamed = true;
    await syncDirectory(dirname(target));
    return { sha256, bytes: String(bytes), lines };
  } finally {
    // Only the failure path leaves a temporary file; it never has the final name.
    if (!renamed) await unlink(temporary).catch(() => undefined);
  }
}

/** NDJSON encoding with bounded buffering: one write per ~64 KiB of lines. */
export async function* encodeLines(lines: AsyncIterable<string>): AsyncIterable<Uint8Array> {
  let pending: string[] = [];
  let size = 0;
  for await (const line of lines) {
    if (line.includes('\n')) throw new BackupFailure('unexpected', 'Line contains a line break');
    pending.push(line);
    size += line.length + 1;
    if (size >= lineBatch) {
      yield Buffer.from(pending.join('\n') + '\n');
      pending = [];
      size = 0;
    }
  }
  if (pending.length) yield Buffer.from(pending.join('\n') + '\n');
}

function missing(error: unknown): boolean {
  return hasCode(error, 'ENOENT') || hasCode(error, 'ENOTDIR');
}

/** Digest and line count of a file, or null when it does not exist. */
export async function digestFile(
  path: string,
  cancellation: Cancellation,
): Promise<FileDigest | null> {
  const hash = createHash('sha256');
  let bytes = 0;
  let lines = 0;
  try {
    for await (const chunk of createReadStream(path, { highWaterMark: 64 * 1024 })) {
      cancellation.throwIfAborted();
      if (!(chunk instanceof Uint8Array)) throw new BackupFailure('unavailable', 'Invalid stream');
      hash.update(chunk);
      bytes += chunk.byteLength;
      for (const byte of chunk) if (byte === 10) lines++;
    }
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
  return { sha256: hash.digest('hex'), bytes: String(bytes), lines };
}

/** SHA-256 of a file with an exact size, or null when it is absent or has another size. */
export async function hashFile(
  path: string,
  size: number,
  cancellation: Cancellation,
): Promise<string | null> {
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size !== size) return null;
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
  const hash = createHash('sha256');
  for await (const chunk of readExactly(path, size)) {
    cancellation.throwIfAborted();
    hash.update(chunk);
  }
  return hash.digest('hex');
}

/** Exactly `size` bytes of a file; a missing or truncated file fails instead of a short read. */
export async function* readExactly(path: string, size: number): AsyncIterable<Uint8Array> {
  if (size === 0) {
    const info = await stat(path).catch((error: unknown) => {
      if (missing(error)) throw new BackupFailure('blob_missing', 'Content file is missing');
      throw error;
    });
    if (info.size !== 0) throw new BackupFailure('integrity_mismatch', 'Content size differs');
    return;
  }
  let remaining = size;
  try {
    for await (const chunk of createReadStream(path, { end: size - 1, highWaterMark: 64 * 1024 })) {
      if (!(chunk instanceof Uint8Array)) throw new BackupFailure('unavailable', 'Invalid stream');
      remaining -= chunk.byteLength;
      yield chunk;
    }
  } catch (error) {
    if (missing(error)) throw new BackupFailure('blob_missing', 'Content file is missing');
    throw error;
  }
  if (remaining !== 0)
    throw new BackupFailure('integrity_mismatch', 'Content ended before its declared size');
}

/**
 * NDJSON lines with bounded length. With `expected`, the iteration fails at its end unless the
 * whole file matches the digest, so a consumer inside a transaction can still roll back.
 */
export async function* readLines(
  path: string,
  options: { maxLine: number; cancellation: Cancellation; expected?: PointFile },
): AsyncIterable<string> {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const hash = createHash('sha256');
  let bytes = 0;
  let pending = '';
  try {
    for await (const chunk of createReadStream(path, { highWaterMark: 64 * 1024 })) {
      options.cancellation.throwIfAborted();
      if (!(chunk instanceof Uint8Array)) throw new BackupFailure('unavailable', 'Invalid stream');
      hash.update(chunk);
      bytes += chunk.byteLength;
      const text = decoder.decode(chunk, { stream: true });
      if (!text.includes('\n')) {
        pending += text;
      } else {
        const parts = (pending + text).split('\n');
        pending = parts.pop() ?? '';
        for (const line of parts) {
          if (line.length > options.maxLine) throw lineTooLong();
          yield line;
        }
      }
      if (pending.length > options.maxLine) throw lineTooLong();
    }
    pending += decoder.decode();
  } catch (error) {
    if (missing(error)) throw new BackupFailure('integrity_mismatch', 'Point file is missing');
    if (error instanceof TypeError)
      throw new BackupFailure('invalid_manifest', 'Point file is not UTF-8', { cause: error });
    throw error;
  }
  if (pending.length)
    throw new BackupFailure('integrity_mismatch', 'Point file ends inside a line');
  const expected = options.expected;
  if (expected && (hash.digest('hex') !== expected.sha256 || String(bytes) !== expected.bytes))
    throw new BackupFailure('integrity_mismatch', 'Point file differs from its manifest');
}

function lineTooLong(): BackupFailure {
  return new BackupFailure('invalid_manifest', 'Point file line exceeds the limit');
}
