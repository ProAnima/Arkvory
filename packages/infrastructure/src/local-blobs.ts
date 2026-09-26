import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, link, unlink, stat, statfs, readFile, rm } from 'node:fs/promises';
import { join, resolve, dirname, relative } from 'node:path';
import { ArkvoryError, requireId } from '@proanima/arkvory-domain';
import type { ArtifactDescriptor, UploadPart } from '@proanima/arkvory-domain';
import type { BlobStore, Cancellation } from '@proanima/arkvory-application';

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

async function syncDirectory(directory: string): Promise<void> {
  // Windows has no supported directory fsync through Node. See ADR 0004.
  if (process.platform === 'win32') return;
  const handle = await open(directory, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export class LocalBlobStore implements BlobStore {
  readonly root: string;
  private reservedBytes = 0;
  constructor(
    root: string,
    private readonly reserveBytes = 256 * 1024 ** 2,
  ) {
    this.root = resolve(root);
  }

  async initialize(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await mkdir(join(this.root, 'blobs'), { recursive: true });
    await mkdir(join(this.root, 'staging'), { recursive: true });
    await mkdir(join(this.root, 'parts'), { recursive: true });
    await syncDirectory(this.root);
  }

  async identity(readOnly = false): Promise<string> {
    const path = join(this.root, 'storage-id');
    try {
      return requireId(await readFile(path, 'utf8'));
    } catch (error) {
      if (!hasCode(error, 'ENOENT') || readOnly) throw error;
    }
    const temporary = join(this.root, `.identity-${randomUUID()}`);
    const handle = await open(temporary, 'wx', 0o600);
    try {
      try {
        await handle.writeFile(randomUUID());
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        await link(temporary, path);
      } catch (error) {
        if (!hasCode(error, 'EEXIST')) throw error;
      }
      await syncDirectory(this.root);
    } finally {
      await unlink(temporary);
    }
    return requireId(await readFile(path, 'utf8'));
  }

  private blob(id: string): string {
    return join(this.root, 'blobs', requireId(id));
  }
  private staging(id: string): string {
    return join(this.root, 'staging', requireId(id));
  }

  async checkSpace(required: number): Promise<void> {
    const volume = await statfs(this.root, { bigint: true });
    if (volume.bavail * volume.bsize < BigInt(required) + BigInt(this.reserveBytes))
      throw new ArkvoryError('capacity_exceeded', 'Insufficient storage capacity');
  }

  async put(
    id: string,
    expected: ArtifactDescriptor,
    source: AsyncIterable<Uint8Array>,
    cancellation: Cancellation,
  ): Promise<void> {
    this.reservedBytes += expected.size;
    try {
      await this.checkSpace(this.reservedBytes);
      await this.write(id, expected, source, cancellation);
    } finally {
      this.reservedBytes -= expected.size;
    }
  }

  private async write(
    id: string,
    expected: ArtifactDescriptor,
    source: AsyncIterable<Uint8Array>,
    cancellation: Cancellation,
    target = this.blob(id),
  ): Promise<void> {
    const directory = this.staging(id);
    await mkdir(directory, { recursive: true });
    await syncDirectory(join(this.root, 'staging'));
    const temporary = join(directory, randomUUID());
    const handle = await open(temporary, 'wx', 0o600);
    let size = 0;
    let nextSpaceCheck = 64 * 1024 ** 2;
    const hash = createHash('sha256');
    try {
      for await (const chunk of source) {
        cancellation.throwIfAborted();
        if (size + chunk.byteLength > expected.size)
          throw new ArkvoryError('integrity_mismatch', 'Uploaded size exceeds declaration');
        let offset = 0;
        while (offset < chunk.byteLength) {
          cancellation.throwIfAborted();
          const { bytesWritten } = await handle.write(
            chunk,
            offset,
            Math.min(chunk.byteLength - offset, 1024 * 1024),
          );
          if (bytesWritten === 0) throw new ArkvoryError('unavailable', 'Storage write failed');
          offset += bytesWritten;
        }
        hash.update(chunk);
        size += chunk.byteLength;
        if (size >= nextSpaceCheck) {
          await this.checkSpace(0);
          nextSpaceCheck = size + 64 * 1024 ** 2;
        }
      }
      cancellation.throwIfAborted();
      if (size !== expected.size || hash.digest('hex') !== expected.sha256)
        throw new ArkvoryError(
          'integrity_mismatch',
          'Uploaded size or SHA-256 differs from declaration',
        );
      await handle.sync();
    } catch (error) {
      await handle.close();
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
    await handle.close();
    try {
      cancellation.throwIfAborted();
      try {
        await link(temporary, target);
      } catch (error) {
        if (!hasCode(error, 'EEXIST')) throw error;
        await this.verifyPath(target, expected, cancellation);
      }
      await syncDirectory(dirname(target));
    } finally {
      await unlink(temporary);
    }
  }

  async exists(id: string, size: number): Promise<void> {
    try {
      const info = await stat(this.blob(id));
      if (!info.isFile() || info.size !== size)
        throw new ArkvoryError('unavailable', 'Artifact content is unavailable');
    } catch (error) {
      if (hasCode(error, 'ENOENT'))
        throw new ArkvoryError('unavailable', 'Artifact content is unavailable');
      throw error;
    }
  }

  async verify(
    id: string,
    expected: ArtifactDescriptor,
    cancellation: Cancellation,
  ): Promise<void> {
    await this.exists(id, expected.size);
    await this.verifyPath(this.blob(id), expected, cancellation);
  }

  private async verifyPath(
    path: string,
    expected: ArtifactDescriptor,
    cancellation: Cancellation,
  ): Promise<void> {
    const info = await stat(path);
    if (info.size !== expected.size)
      throw new ArkvoryError('integrity_mismatch', 'Stored size mismatch');
    const hash = createHash('sha256');
    for await (const chunk of this.streamFile(path, expected.size)) {
      cancellation.throwIfAborted();
      hash.update(chunk);
    }
    cancellation.throwIfAborted();
    if (hash.digest('hex') !== expected.sha256)
      throw new ArkvoryError('integrity_mismatch', 'Stored content failed integrity verification');
    await syncDirectory(dirname(path));
  }

  async *read(
    id: string,
    size: number,
    range?: { start: number; end: number },
  ): AsyncIterable<Uint8Array> {
    yield* this.streamFile(this.blob(id), size, range);
  }

  private async *streamFile(
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

  private partPath(id: string, part: UploadPart): string {
    if (
      !Number.isSafeInteger(part.index) ||
      part.index < 0 ||
      part.index >= 640 ||
      !/^[a-f0-9]{64}$/.test(part.sha256)
    )
      throw new ArkvoryError('invalid_input', 'Invalid part');
    return join(this.root, 'parts', requireId(id), `${String(part.index)}-${part.sha256}`);
  }

  async putPart(
    id: string,
    part: UploadPart,
    source: AsyncIterable<Uint8Array>,
    cancellation: Cancellation,
  ): Promise<void> {
    const path = this.partPath(id, part);
    await mkdir(dirname(path), { recursive: true });
    await syncDirectory(join(this.root, 'parts'));
    this.reservedBytes += part.size;
    try {
      await this.checkSpace(this.reservedBytes);
      await this.write(
        id,
        { name: 'part', size: part.size, sha256: part.sha256, labels: [], metadata: {} },
        source,
        cancellation,
        path,
      );
    } finally {
      this.reservedBytes -= part.size;
    }
  }

  async *readParts(id: string, parts: readonly UploadPart[]): AsyncIterable<Uint8Array> {
    for (const part of parts) yield* this.streamFile(this.partPath(id, part), part.size);
  }

  async collect(id: string, removeContent: boolean, cancellation: Cancellation): Promise<void> {
    // Both cleanup modes hold upload ownership and an exclusive content guard for blob removal.
    requireId(id);
    for (const folder of ['staging', 'parts']) {
      cancellation.throwIfAborted();
      const target = resolve(this.root, folder, id);
      if (relative(resolve(this.root, folder), target) !== id)
        throw new ArkvoryError('invalid_input', 'Unsafe cleanup target');
      await rm(target, { recursive: true, force: true });
      cancellation.throwIfAborted();
      await syncDirectory(join(this.root, folder));
    }
    if (removeContent) {
      cancellation.throwIfAborted();
      try {
        await unlink(this.blob(id));
      } catch (error) {
        if (!hasCode(error, 'ENOENT')) throw error;
      }
      cancellation.throwIfAborted();
      await syncDirectory(join(this.root, 'blobs'));
    }
    cancellation.throwIfAborted();
  }

  contentPath(id: string): string {
    return this.blob(id);
  }

  async ready(): Promise<void> {
    await stat(join(this.root, 'blobs'));
  }
}
