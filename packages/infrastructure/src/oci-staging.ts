import { createReadStream } from 'node:fs';
import { mkdir, open, readdir, rm, stat } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { OciError, requireId } from '@proanima/arkvory-domain';
import type { Cancellation, OciStaging } from '@proanima/arkvory-application';
import { hasCode } from './fs-durability.js';

const spaceCheckBytes = 64 * 1024 ** 2;
const writeBytes = 1024 * 1024;

async function writeAll(handle: FileHandle, chunk: Uint8Array, position: number) {
  let offset = 0;
  while (offset < chunk.byteLength) {
    const length = Math.min(chunk.byteLength - offset, writeBytes);
    const { bytesWritten } = await handle.write(chunk, offset, length, position + offset);
    if (bytesWritten === 0) throw new Error('Staging write made no progress');
    offset += bytesWritten;
  }
}

/**
 * Uploads in progress as one file each under `<data>/oci-uploads` (ADR 0063), on the volume of
 * the artifact store so that its free-space reserve covers them. The database row is the record
 * of what was received: bytes past it, left by an interrupted request, are cut off on the next
 * append. Each append is synced before the row moves forward.
 */
export class FileOciStaging implements OciStaging {
  private readonly root: string;
  constructor(
    dataDirectory: string,
    private readonly space: (bytes: number) => Promise<void>,
  ) {
    this.root = resolve(dataDirectory, 'oci-uploads');
  }

  private path(id: string) {
    return join(this.root, requireId(id));
  }

  async append(
    id: string,
    offset: number,
    source: AsyncIterable<Uint8Array>,
    limit: number,
    cancellation: Cancellation,
  ): Promise<number> {
    await mkdir(this.root, { recursive: true });
    await this.space(spaceCheckBytes);
    const handle = await open(this.path(id), offset === 0 ? 'w' : 'r+', 0o600).catch(
      (error: unknown) => {
        if (hasCode(error, 'ENOENT'))
          throw new OciError('BLOB_UPLOAD_INVALID', 'Staged bytes of this upload are gone');
        throw error;
      },
    );
    try {
      if ((await handle.stat()).size < offset)
        throw new OciError('BLOB_UPLOAD_INVALID', 'Staged bytes of this upload are incomplete');
      await handle.truncate(offset);
      let size = offset;
      let nextCheck = offset + spaceCheckBytes;
      for await (const chunk of source) {
        cancellation.throwIfAborted();
        if (size + chunk.byteLength > limit)
          throw new OciError('SIZE_INVALID', 'Blob exceeds the configured maximum size');
        await writeAll(handle, chunk, size);
        size += chunk.byteLength;
        if (size >= nextCheck) {
          await this.space(spaceCheckBytes);
          nextCheck = size + spaceCheckBytes;
        }
      }
      cancellation.throwIfAborted();
      await handle.sync();
      return size;
    } finally {
      await handle.close();
    }
  }

  async *read(id: string): AsyncIterable<Uint8Array> {
    const stream = createReadStream(this.path(id), { highWaterMark: writeBytes });
    try {
      for await (const chunk of stream) {
        if (!(chunk instanceof Uint8Array)) throw new Error('Staging read returned text');
        yield chunk;
      }
    } catch (error) {
      // A blob pushed without any bytes has no staged file; the store checks the size.
      if (!hasCode(error, 'ENOENT')) throw error;
    } finally {
      stream.destroy();
    }
  }

  async remove(id: string): Promise<void> {
    await rm(this.path(id), { force: true });
  }

  async prune(seconds: number): Promise<void> {
    let names: string[];
    try {
      names = await readdir(this.root);
    } catch (error) {
      if (hasCode(error, 'ENOENT')) return;
      throw error;
    }
    const oldest = Date.now() - seconds * 1000;
    for (const name of names) {
      const path = join(this.root, name);
      try {
        if ((await stat(path)).mtimeMs < oldest) await rm(path, { force: true });
      } catch (error) {
        if (!hasCode(error, 'ENOENT')) throw error;
      }
    }
  }
}
