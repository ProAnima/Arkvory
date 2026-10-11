import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readdir, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ArkvoryError, requireId } from '@proanima/arkvory-domain';
import type { Cancellation, RawStaging } from '@proanima/arkvory-application';
import { hasCode } from './fs-durability.js';
import { stagedFile } from './blob-files.js';

const spaceCheckBytes = 64 * 1024 ** 2;
const ioBytes = 1024 * 1024;

/**
 * Raw uploads without a checksum (ADR 0064), one file each under `<data>/raw-staging`, on the
 * volume of the artifact store so that its free-space reserve covers them; hashed while written.
 * Not synced while written: the artifact store syncs the file and adopts it as the blob, with
 * the size and SHA-256 measured here (ADR 0074); a crash only leaves a file that `prune` removes.
 */
export class FileRawStaging implements RawStaging {
  private readonly root: string;
  /** Size and SHA-256 measured while each staged file was written, until it is removed. */
  private readonly measured = new Map<string, { size: number; sha256: string }>();
  constructor(
    dataDirectory: string,
    private readonly space: (bytes: number) => Promise<void>,
  ) {
    this.root = resolve(dataDirectory, 'raw-staging');
  }

  private path(id: string) {
    return join(this.root, requireId(id));
  }

  async stage(source: AsyncIterable<Uint8Array>, limit: number, cancellation: Cancellation) {
    await mkdir(this.root, { recursive: true });
    await this.space(spaceCheckBytes);
    const id = randomUUID();
    const handle = await open(this.path(id), 'wx', 0o600);
    const hash = createHash('sha256');
    let size = 0;
    let nextCheck = spaceCheckBytes;
    try {
      for await (const chunk of source) {
        cancellation.throwIfAborted();
        if (size + chunk.byteLength > limit)
          throw new ArkvoryError('invalid_input', 'Object exceeds the configured maximum size');
        let offset = 0;
        while (offset < chunk.byteLength) {
          const length = Math.min(chunk.byteLength - offset, ioBytes);
          const { bytesWritten } = await handle.write(chunk, offset, length, size + offset);
          if (bytesWritten === 0) throw new Error('Staging write made no progress');
          offset += bytesWritten;
        }
        hash.update(chunk);
        size += chunk.byteLength;
        if (size >= nextCheck) {
          await this.space(spaceCheckBytes);
          nextCheck = size + spaceCheckBytes;
        }
      }
      cancellation.throwIfAborted();
    } catch (error) {
      await handle.close();
      await this.remove(id);
      throw error;
    }
    await handle.close();
    const sha256 = hash.digest('hex');
    this.measured.set(id, { size, sha256 });
    return { id, size, sha256 };
  }

  /** The staged bytes; the artifact store adopts the file itself (ADR 0074). */
  read(id: string): AsyncIterable<Uint8Array> {
    return stagedFile(this.path(id), () => this.bytes(id), this.measured.get(id));
  }

  private async *bytes(id: string): AsyncIterable<Uint8Array> {
    const stream = createReadStream(this.path(id), { highWaterMark: ioBytes });
    try {
      for await (const chunk of stream) {
        if (!(chunk instanceof Uint8Array)) throw new Error('Staging read returned text');
        yield chunk;
      }
    } finally {
      stream.destroy();
    }
  }

  async remove(id: string): Promise<void> {
    this.measured.delete(id);
    await rm(this.path(id), { force: true });
  }

  /** Files left by a crash; a live upload touches its file at least every write. */
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
