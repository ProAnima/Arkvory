import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { ModuleServiceError } from '@proanima/arkvory-extension-api';
import type { ByteRange, CacheRead, ModuleSignal, Page } from '@proanima/arkvory-extension-api';
import { requireDataName, requireInside } from './module-data-paths.js';
import {
  CacheQueue,
  CACHE_IO_BYTES,
  CACHE_FILES,
  cacheFile,
  unavailable,
} from './derived-cache-runtime.js';
import type { CacheFileEntry } from './derived-cache-runtime.js';

export async function readCacheManifest(
  directory: string,
  digest: string,
  handles: Set<FileHandle>,
): Promise<CacheFileEntry[]> {
  await requireInside(directory, ['manifest']);
  const file = await open(join(directory, 'manifest'), 'r');
  handles.add(file);
  let bytes: Buffer;
  try {
    const size = (await file.stat()).size;
    if (size > 4 * 1024 * 1024) throw unavailable();
    const buffer = Buffer.alloc(size + 1);
    let used = 0;
    while (used < buffer.length) {
      const { bytesRead } = await file.read(buffer, used, buffer.length - used, used);
      if (bytesRead === 0) break;
      used += bytesRead;
    }
    if (used !== size) throw unavailable();
    bytes = buffer.subarray(0, used);
  } finally {
    await file.close();
    handles.delete(file);
  }
  if (createHash('sha256').update(bytes).digest('hex') !== digest) throw unavailable();
  const value: unknown = JSON.parse(bytes.toString('utf8'));
  if (!Array.isArray(value) || value.length > CACHE_FILES - 3) throw unavailable();
  const entries: CacheFileEntry[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) throw unavailable();
    const name: unknown = Reflect.get(entry, 'name');
    const size: unknown = Reflect.get(entry, 'size');
    const sha256: unknown = Reflect.get(entry, 'sha256');
    if (
      typeof name !== 'string' ||
      Buffer.byteLength(name) > 512 ||
      typeof size !== 'number' ||
      !Number.isSafeInteger(size) ||
      size < 0 ||
      typeof sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(sha256)
    )
      throw unavailable();
    requireDataName(name);
    const previous = entries.at(-1);
    if (previous && previous.name >= name) throw unavailable();
    entries.push({ name, size, sha256 });
  }
  return entries;
}

export interface CacheReadHost {
  check(): void;
  release(): Promise<void>;
}

/** A persisted reader reference outlives a lost PG session until OS handles are closed.
 * A paused generator does not prevent release: every descriptor is owned here, not by it. */
export class GenerationRead implements CacheRead {
  private readonly queue = new CacheQueue();
  private readonly handles = new Set<FileHandle>();
  private released = false;
  private releasing: Promise<void> | undefined;
  private readonly cancel = () => {
    void this.release().catch(() => undefined);
  };
  constructor(
    private readonly directory: string,
    private readonly entries: readonly CacheFileEntry[],
    private readonly signal: ModuleSignal,
    private readonly host: CacheReadHost,
  ) {
    signal.addEventListener('abort', this.cancel, { once: true });
  }

  private check(): void {
    if (this.released) throw unavailable();
    this.signal.throwIfAborted();
    this.host.check();
  }

  private entry(name: string): CacheFileEntry | undefined {
    this.check();
    requireDataName(name);
    return this.entries.find((entry) => entry.name === name);
  }

  stat(name: string): Promise<{ size: number } | null> {
    return this.queue.run(() => {
      const entry = this.entry(name);
      return entry ? { size: entry.size } : null;
    });
  }

  list(after: string | null, limit: number): Promise<Page<string>> {
    return this.queue.run(() => {
      this.check();
      if (
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 1000 ||
        (after !== null && typeof after !== 'string')
      )
        throw new ModuleServiceError('invalid_input');
      const names = this.entries.filter((entry) => after === null || entry.name > after);
      const items = names.slice(0, limit).map((entry) => entry.name);
      return { items, next: names.length > limit ? (items.at(-1) ?? null) : null };
    });
  }

  private async opened(entry: CacheFileEntry): Promise<FileHandle> {
    return this.queue.run(async () => {
      this.check();
      if (this.handles.size >= 8) throw new ModuleServiceError('busy');
      const name = cacheFile(entry.name);
      await requireInside(this.directory, [name]);
      const handle = await open(join(this.directory, name), 'r');
      this.handles.add(handle);
      return handle;
    });
  }

  private async chunk(handle: FileHandle, position: number, size: number): Promise<Buffer> {
    return this.queue.run(async () => {
      this.check();
      const bytes = Buffer.allocUnsafe(Math.min(size, CACHE_IO_BYTES));
      const result = await handle.read(bytes, 0, bytes.length, position);
      this.check();
      if (result.bytesRead === 0 && size !== 0) throw unavailable();
      return bytes.subarray(0, result.bytesRead);
    });
  }

  async *read(name: string, range?: ByteRange): AsyncIterable<Uint8Array> {
    const entry = this.entry(name);
    if (!entry) throw unavailable();
    const start = range?.start ?? 0;
    const end = range?.end ?? entry.size - 1;
    if (
      range &&
      (!Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start < 0 ||
        end < start ||
        end >= entry.size)
    )
      throw new ModuleServiceError('invalid_input');
    const handle = await this.opened(entry);
    try {
      const size = await this.queue.run(async () => {
        this.check();
        return (await handle.stat()).size;
      });
      if (size !== entry.size) throw unavailable();
      // Authenticate the immutable file before a range is returned. No whole-file buffering.
      const hash = createHash('sha256');
      for (let offset = 0; offset < size;) {
        const bytes = await this.chunk(handle, offset, size - offset);
        hash.update(bytes);
        offset += bytes.length;
      }
      if (hash.digest('hex') !== entry.sha256) throw unavailable();
      for (let offset = start; offset <= end;) {
        const bytes = await this.chunk(handle, offset, end - offset + 1);
        offset += bytes.length;
        yield bytes;
      }
    } finally {
      await this.queue.run(async () => {
        if (this.handles.has(handle)) {
          await handle.close();
          this.handles.delete(handle);
        }
      });
    }
  }

  release(): Promise<void> {
    this.released = true;
    this.signal.removeEventListener('abort', this.cancel);
    return (this.releasing ??= this.queue
      .run(async () => {
        // Close all descriptors before releasing the persistent reference or the PG pin.
        for (const handle of this.handles) {
          await handle.close();
          this.handles.delete(handle);
        }
        await this.host.release();
      })
      .catch((error: unknown) => {
        this.releasing = undefined;
        throw error;
      }));
  }
}
