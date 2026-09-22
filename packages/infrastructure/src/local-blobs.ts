import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, link, unlink, stat, statfs, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DepotError, requireId } from '@proanima/depot-domain';
import type { ArtifactDescriptor } from '@proanima/depot-domain';
import type { BlobStore, Cancellation } from '@proanima/depot-application';

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
    await syncDirectory(this.root);
  }

  async identity(): Promise<string> {
    const path = join(this.root, 'storage-id');
    try {
      return requireId(await readFile(path, 'utf8'));
    } catch (error) {
      if (!hasCode(error, 'ENOENT')) throw error;
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
      throw new DepotError('capacity_exceeded', 'Insufficient storage capacity');
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
          throw new DepotError('integrity_mismatch', 'Uploaded size exceeds declaration');
        let offset = 0;
        while (offset < chunk.byteLength) {
          cancellation.throwIfAborted();
          const { bytesWritten } = await handle.write(
            chunk,
            offset,
            Math.min(chunk.byteLength - offset, 1024 * 1024),
          );
          if (bytesWritten === 0) throw new DepotError('unavailable', 'Storage write failed');
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
        throw new DepotError(
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
        await link(temporary, this.blob(id));
      } catch (error) {
        if (!hasCode(error, 'EEXIST')) throw error;
        await this.verify(id, expected, cancellation);
      }
      await syncDirectory(join(this.root, 'blobs'));
    } finally {
      await unlink(temporary);
    }
  }

  async exists(id: string, size: number): Promise<void> {
    try {
      const info = await stat(this.blob(id));
      if (!info.isFile() || info.size !== size)
        throw new DepotError('unavailable', 'Artifact content is unavailable');
    } catch (error) {
      if (hasCode(error, 'ENOENT'))
        throw new DepotError('unavailable', 'Artifact content is unavailable');
      throw error;
    }
  }

  async verify(
    id: string,
    expected: ArtifactDescriptor,
    cancellation: Cancellation,
  ): Promise<void> {
    await this.exists(id, expected.size);
    const hash = createHash('sha256');
    for await (const chunk of this.read(id, expected.size)) {
      cancellation.throwIfAborted();
      hash.update(chunk);
    }
    cancellation.throwIfAborted();
    if (hash.digest('hex') !== expected.sha256)
      throw new DepotError('integrity_mismatch', 'Stored content failed integrity verification');
    await syncDirectory(join(this.root, 'blobs'));
  }

  async *read(
    id: string,
    size: number,
    range?: { start: number; end: number },
  ): AsyncIterable<Uint8Array> {
    if (size === 0) return;
    const stream = createReadStream(this.blob(id), {
      start: range?.start ?? 0,
      end: range?.end ?? size - 1,
      highWaterMark: 64 * 1024,
    });
    for await (const chunk of stream) {
      if (!(chunk instanceof Uint8Array))
        throw new DepotError('unavailable', 'Invalid content stream');
      yield chunk;
    }
  }

  async ready(): Promise<void> {
    await stat(join(this.root, 'blobs'));
  }
}
