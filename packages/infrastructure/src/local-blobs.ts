import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, link, unlink, stat, readFile, readdir, rm } from 'node:fs/promises';
import { join, resolve, dirname, relative } from 'node:path';
import { ArkvoryError, MAX_PARTS, requireId } from '@proanima/arkvory-domain';
import type { ArtifactDescriptor, UploadPart } from '@proanima/arkvory-domain';
import type { BlobStore, Cancellation } from '@proanima/arkvory-application';
import { hasCode, syncDirectory } from './fs-durability.js';
import type { StorageLifecycle } from './storage-lifecycle.js';
import { requireVolumeRoom } from './volume-space.js';
import {
  adoptStagedFile,
  internalChunkBytes,
  stagedFileOf,
  streamFile,
  verifyFile,
} from './blob-files.js';

/** Free space kept for the database, logs and the OS; ARKVORY_STORAGE_RESERVE_BYTES. */
export const defaultStorageReserveBytes = 1024 ** 3;
export function storageReserveBytes(raw: string | undefined): number {
  if (raw === undefined) return defaultStorageReserveBytes;
  const value = Number(raw);
  if (!/^(0|[1-9][0-9]*)$/.test(raw) || !Number.isSafeInteger(value))
    throw new Error('Invalid ARKVORY_STORAGE_RESERVE_BYTES');
  return value;
}

/** Free inodes kept on the volume (ADR 0083, N6); ARKVORY_STORAGE_RESERVE_INODES. */
export const defaultStorageReserveInodes = 100_000;
export function storageReserveInodes(raw: string | undefined): number {
  if (raw === undefined) return defaultStorageReserveInodes;
  const value = Number(raw);
  if (!/^(0|[1-9][0-9]*)$/.test(raw) || !Number.isSafeInteger(value))
    throw new Error('Invalid ARKVORY_STORAGE_RESERVE_INODES');
  return value;
}

/**
 * A storage on a volume of its own (ADR 0083, N11), such as a second disk: its layout folders
 * are made only by `initialize`, and only inside a directory that exists unless `createRoot`
 * (a restore target). A volume that is not mounted has no layout beneath its mount point, so
 * neither a first start nor a write ever puts files on the file system below it.
 */
export interface VolumeLayout {
  readonly createRoot: boolean;
}

/** The folder of one upload inside a layout folder that must exist already. */
async function volumeFolder(path: string): Promise<void> {
  try {
    await mkdir(path);
  } catch (error) {
    if (hasCode(error, 'EEXIST')) return;
    if (hasCode(error, 'ENOENT'))
      throw new ArkvoryError('unavailable', 'Storage layout is missing');
    throw error;
  }
}

/** The storage's own id in `storage-id`, created durably on first use unless `readOnly`. */
async function storageIdentity(root: string, readOnly: boolean): Promise<string> {
  const path = join(root, 'storage-id');
  try {
    return requireId(await readFile(path, 'utf8'));
  } catch (error) {
    if (!hasCode(error, 'ENOENT') || readOnly) throw error;
  }
  const temporary = join(root, `.identity-${randomUUID()}`);
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
    await syncDirectory(root);
  } finally {
    await unlink(temporary);
  }
  return requireId(await readFile(path, 'utf8'));
}

export class LocalBlobStore implements BlobStore, StorageLifecycle {
  readonly root: string;
  private reservedBytes = 0;
  constructor(
    root: string,
    private readonly reserveBytes = defaultStorageReserveBytes,
    /** Mode of a root that `initialize` creates; a restore target is private (0700). */
    private readonly rootMode?: number,
    private readonly volume?: VolumeLayout,
    private readonly reserveInodes = defaultStorageReserveInodes,
  ) {
    if (!Number.isSafeInteger(reserveBytes) || reserveBytes < 0)
      throw new Error('Invalid storage reserve');
    if (!Number.isSafeInteger(reserveInodes) || reserveInodes < 0)
      throw new Error('Invalid storage inode reserve');
    this.root = resolve(root);
  }

  async initialize(): Promise<void> {
    if (this.volume && !this.volume.createRoot) {
      if (!(await stat(this.root)).isDirectory())
        throw new ArkvoryError('unavailable', 'Storage directory is not a directory');
    } else
      await mkdir(this.root, {
        recursive: true,
        ...(this.rootMode === undefined ? {} : { mode: this.rootMode }),
      });
    await mkdir(join(this.root, 'blobs'), { recursive: true });
    await mkdir(join(this.root, 'staging'), { recursive: true });
    await mkdir(join(this.root, 'parts'), { recursive: true });
    await syncDirectory(this.root);
  }

  async identity(readOnly = false): Promise<string> {
    return storageIdentity(this.root, readOnly);
  }

  private blob(id: string): string {
    return join(this.root, 'blobs', requireId(id));
  }
  private staging(id: string): string {
    return join(this.root, 'staging', requireId(id));
  }
  private async folder(path: string): Promise<void> {
    if (this.volume) await volumeFolder(path);
    else await mkdir(path, { recursive: true });
  }

  /** Bytes beside the reserve, and free inodes: each blob and part is a file (ADR 0083, N6). */
  async checkSpace(required: number): Promise<void> {
    await requireVolumeRoom(this.root, required, {
      bytes: this.reserveBytes,
      inodes: this.reserveInodes,
    });
  }

  async put(
    id: string,
    expected: ArtifactDescriptor,
    source: AsyncIterable<Uint8Array>,
    cancellation: Cancellation,
  ): Promise<void> {
    if (await this.adopt(source, expected, this.blob(id), cancellation)) return;
    this.reservedBytes += expected.size;
    try {
      await this.checkSpace(this.reservedBytes);
      await this.write(id, expected, source, cancellation);
    } finally {
      this.reservedBytes -= expected.size;
    }
  }

  /** A staged file on this volume needs no new space: it becomes the blob itself (ADR 0074). */
  private async adopt(
    source: AsyncIterable<Uint8Array>,
    expected: ArtifactDescriptor,
    target: string,
    cancellation: Cancellation,
  ): Promise<boolean> {
    const staged = stagedFileOf(source);
    return staged !== null && (await adoptStagedFile(staged, expected, target, cancellation));
  }

  private async write(
    id: string,
    expected: ArtifactDescriptor,
    source: AsyncIterable<Uint8Array>,
    cancellation: Cancellation,
    target = this.blob(id),
  ): Promise<void> {
    const directory = this.staging(id);
    await this.folder(directory);
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
        await verifyFile(target, expected, cancellation);
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
    await verifyFile(this.blob(id), expected, cancellation);
  }

  async duplicate(
    sourceId: string,
    targetId: string,
    expected: ArtifactDescriptor,
    cancellation: Cancellation,
  ): Promise<void> {
    await this.exists(sourceId, expected.size);
    const target = this.blob(targetId);
    cancellation.throwIfAborted();
    try {
      // Published blobs are immutable, so a second directory entry shares bytes safely.
      await link(this.blob(sourceId), target);
    } catch (error) {
      if (!hasCode(error, 'EEXIST')) throw error;
      const [left, right] = await Promise.all([
        stat(this.blob(sourceId), { bigint: true }),
        stat(target, { bigint: true }),
      ]);
      if (left.ino !== right.ino || left.dev !== right.dev)
        await verifyFile(target, expected, cancellation);
    }
    await syncDirectory(dirname(target));
  }

  /** A missing file is `unavailable`, as for `exists`: readers never see a file system code. */
  async *read(
    id: string,
    size: number,
    range?: { start: number; end: number },
  ): AsyncIterable<Uint8Array> {
    try {
      yield* streamFile(this.blob(id), size, range);
    } catch (error) {
      if (hasCode(error, 'ENOENT'))
        throw new ArkvoryError('unavailable', 'Artifact content is unavailable');
      throw error;
    }
  }

  private partPath(id: string, part: UploadPart): string {
    if (
      !Number.isSafeInteger(part.index) ||
      part.index < 0 ||
      part.index >= MAX_PARTS ||
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
    await this.folder(dirname(path));
    await syncDirectory(join(this.root, 'parts'));
    const descriptor = {
      name: 'part',
      size: part.size,
      sha256: part.sha256,
      labels: [],
      metadata: {},
    };
    if (await this.adopt(source, descriptor, path, cancellation)) return;
    this.reservedBytes += part.size;
    try {
      await this.checkSpace(this.reservedBytes);
      await this.write(id, descriptor, source, cancellation, path);
    } finally {
      this.reservedBytes -= part.size;
    }
  }

  /** A missing part (a volume that is not mounted, say) is `unavailable`: completion retries. */
  async *readParts(id: string, parts: readonly UploadPart[]): AsyncIterable<Uint8Array> {
    try {
      for (const part of parts)
        yield* streamFile(this.partPath(id, part), part.size, undefined, internalChunkBytes);
    } catch (error) {
      if (hasCode(error, 'ENOENT'))
        throw new ArkvoryError('unavailable', 'Upload part is unavailable');
      throw error;
    }
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

  async ready(): Promise<void> {
    await stat(join(this.root, 'blobs'));
  }

  /** A restore target must hold nothing yet: an absent or empty storage directory. */
  async requireEmpty(): Promise<void> {
    try {
      if ((await readdir(this.root)).length)
        throw new ArkvoryError('conflict', 'Storage directory is not empty', {
          reason: 'already_exists',
        });
    } catch (error) {
      if (!hasCode(error, 'ENOENT')) throw error;
    }
  }
}
