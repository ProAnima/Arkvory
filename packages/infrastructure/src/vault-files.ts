import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, rename, stat, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { BackupFailure } from '@proanima/arkvory-domain';
import type { PointFile } from '@proanima/arkvory-domain';
import type { Cancellation, FileDigest } from '@proanima/arkvory-application';
import type { FileCipher } from './vault-crypto.js';
import { hasCode, syncDirectory } from './fs-durability.js';

/** A plain vault holds catalog data and content in the clear (ADR 0054): owner-only access. */
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
  options: {
    cancellation: Cancellation;
    expected?: WriteExpectation;
    countLines?: boolean;
    /** Encrypts the file; digest, size and line count stay those of the content (ADR 0070). */
    cipher?: FileCipher;
  },
): Promise<FileDigest> {
  const temporary = join(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx', VAULT_FILE_MODE);
  const hash = createHash('sha256');
  let bytes = 0;
  let lines = 0;
  let renamed = false;
  // The content is measured as it passes, before any encryption.
  async function* measured(): AsyncIterable<Uint8Array> {
    for await (const chunk of chunks) {
      options.cancellation.throwIfAborted();
      if (options.expected && bytes + chunk.byteLength > options.expected.size)
        throw new BackupFailure('integrity_mismatch', 'Content is longer than its inventory size');
      hash.update(chunk);
      bytes += chunk.byteLength;
      if (options.countLines) for (const byte of chunk) if (byte === 10) lines++;
      yield chunk;
    }
  }
  try {
    try {
      for await (const chunk of options.cipher ? options.cipher.encrypt(measured()) : measured()) {
        for (let offset = 0; offset < chunk.byteLength;) {
          const { bytesWritten } = await handle.write(
            chunk,
            offset,
            Math.min(chunk.byteLength - offset, writeSlice),
          );
          if (bytesWritten === 0) throw new BackupFailure('unavailable', 'Vault write failed');
          offset += bytesWritten;
        }
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

/** The path or one of its parent directories does not exist. */
export function missing(error: unknown): boolean {
  return hasCode(error, 'ENOENT') || hasCode(error, 'ENOTDIR');
}

/** Chunks of a file; with a cipher the plain content of an encrypted file (ADR 0070). */
async function* fileChunks(path: string, cipher?: FileCipher): AsyncIterable<Uint8Array> {
  const stream = (async function* () {
    for await (const chunk of createReadStream(path, { highWaterMark: 64 * 1024 })) {
      if (!(chunk instanceof Uint8Array)) throw new BackupFailure('unavailable', 'Invalid stream');
      yield chunk;
    }
  })();
  yield* cipher ? cipher.decrypt(stream) : stream;
}

/**
 * Digest and line count of the content of a file, or null when it does not exist. An encrypted
 * file is decrypted on the way, so the digest is the one the manifest recorded.
 */
export async function digestFile(
  path: string,
  cancellation: Cancellation,
  cipher?: FileCipher,
): Promise<FileDigest | null> {
  const hash = createHash('sha256');
  let bytes = 0;
  let lines = 0;
  try {
    for await (const chunk of fileChunks(path, cipher)) {
      cancellation.throwIfAborted();
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

/** SHA-256 of the content of a file of an exact size, or null when it is absent or has another size. */
export async function hashFile(
  path: string,
  size: number,
  cancellation: Cancellation,
  cipher?: FileCipher,
): Promise<string | null> {
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size !== (cipher ? cipher.encryptedSize(size) : size)) return null;
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
  const hash = createHash('sha256');
  for await (const chunk of readExactly(path, size, cipher)) {
    cancellation.throwIfAborted();
    hash.update(chunk);
  }
  return hash.digest('hex');
}

/** Exactly `size` bytes of content; a missing or truncated file fails instead of a short read. */
export async function* readExactly(
  path: string,
  size: number,
  cipher?: FileCipher,
): AsyncIterable<Uint8Array> {
  if (cipher) {
    let remaining = size;
    try {
      for await (const chunk of fileChunks(path, cipher)) {
        remaining -= chunk.byteLength;
        if (remaining < 0) throw new BackupFailure('integrity_mismatch', 'Content size differs');
        yield chunk;
      }
    } catch (error) {
      if (missing(error)) throw new BackupFailure('blob_missing', 'Content file is missing');
      throw error;
    }
    if (remaining !== 0)
      throw new BackupFailure('integrity_mismatch', 'Content ended before its declared size');
    return;
  }
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
 * whole content matches the digest, so a consumer inside a transaction can still roll back.
 */
export async function* readLines(
  path: string,
  options: {
    maxLine: number;
    cancellation: Cancellation;
    expected?: PointFile;
    cipher?: FileCipher;
  },
): AsyncIterable<string> {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const hash = createHash('sha256');
  let bytes = 0;
  let pending = '';
  try {
    for await (const chunk of fileChunks(path, options.cipher)) {
      options.cancellation.throwIfAborted();
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
