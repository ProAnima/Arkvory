import { createHash } from 'node:crypto';
import { open, rename, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { ModuleServiceError } from '@proanima/arkvory-extension-api';
import type { CacheBuild, FileSink, ModuleSignal } from '@proanima/arkvory-extension-api';
import { syncDirectory, hasCode } from './fs-durability.js';
import { requireDataName } from './module-data-paths.js';
import { CacheQueue, cacheFile, CACHE_IO_BYTES } from './derived-cache-runtime.js';
import type { CacheBudget, CacheFileEntry } from './derived-cache-runtime.js';

export interface CacheBuildHost {
  check(): void;
  room(bytes: number): Promise<void>;
  publish(actual: CacheBudget, manifestHash: string): Promise<void>;
  retire(): Promise<void>;
  settled(): void;
}

/** Unique flat namespace: no file operation can reach another generation. A failed or
 * paused owner retains its full reservation until all its I/O is proved quiescent. */
export class GenerationBuild implements CacheBuild {
  private readonly queue = new CacheQueue();
  private readonly entries: CacheFileEntry[] = [];
  private readonly names = new Set<string>();
  private pending: { handle: FileHandle; path: string; closed: boolean } | undefined;
  private bytes = 0;
  private manifestBudget = 32;
  private state: 'building' | 'sealed' | 'committed' | 'aborted' = 'building';
  private failed = false;
  private manifest: { bytes: number; hash: string } | undefined;
  private manifestHandle: FileHandle | undefined;
  private readonly cancel = () => {
    void this.abort().catch(() => undefined);
  };

  constructor(
    private readonly directory: string,
    private readonly budget: CacheBudget,
    private readonly signal: ModuleSignal,
    private readonly host: CacheBuildHost,
  ) {
    signal.addEventListener('abort', this.cancel, { once: true });
  }

  private check(): void {
    this.signal.throwIfAborted();
    this.host.check();
    if (this.state !== 'building' || this.failed) throw new ModuleServiceError('conflict');
  }

  create(name: string): Promise<FileSink> {
    return this.queue.run(async () => {
      this.check();
      requireDataName(name);
      if (Buffer.byteLength(name) > 512) throw new ModuleServiceError('invalid_input');
      if (this.pending || this.names.has(name)) throw new ModuleServiceError('conflict');
      // One sink at a time bounds physical publication overhead (manifest and temporary).
      const overhead = Buffer.byteLength(JSON.stringify(name)) + 128;
      if (
        this.entries.length + 4 > this.budget.files ||
        this.bytes + this.manifestBudget + overhead > this.budget.bytes
      )
        throw new ModuleServiceError('module_quota_exceeded');
      const path = join(this.directory, `pending-${cacheFile(name)}`);
      await this.host.room(0);
      const handle = await open(path, 'wx', 0o600);
      const pending = { handle, path, closed: false };
      this.pending = pending;
      this.names.add(name);
      this.manifestBudget += overhead;
      const hash = createHash('sha256');
      let size = 0;
      let published = false;
      return {
        write: (chunk) =>
          this.queue.run(async () => {
            this.check();
            if (this.pending !== pending || pending.closed)
              throw new ModuleServiceError('conflict');
            if (!(chunk instanceof Uint8Array)) throw new ModuleServiceError('invalid_input');
            try {
              if (
                !Number.isSafeInteger(this.bytes + chunk.length) ||
                this.bytes + chunk.length + this.manifestBudget > this.budget.bytes
              )
                throw new ModuleServiceError('module_quota_exceeded');
              for (let offset = 0; offset < chunk.length;) {
                this.check();
                const length = Math.min(CACHE_IO_BYTES, chunk.length - offset);
                await this.host.room(length);
                const result = await handle.write(chunk, offset, length);
                if (result.bytesWritten === 0) throw new ModuleServiceError('unavailable');
                hash.update(chunk.subarray(offset, offset + result.bytesWritten));
                size += result.bytesWritten;
                this.bytes += result.bytesWritten;
                offset += result.bytesWritten;
              }
            } catch (error) {
              this.failed = true;
              throw error;
            }
          }),
        close: () =>
          this.queue.run(async () => {
            if (published) return;
            this.check();
            if (this.pending !== pending) throw new ModuleServiceError('conflict');
            try {
              await handle.sync();
              await handle.close();
              pending.closed = true;
              this.check();
              await rename(path, join(this.directory, cacheFile(name)));
              this.entries.push({ name, size, sha256: hash.digest('hex') });
              published = true;
              this.pending = undefined;
            } catch (error) {
              this.failed = true;
              throw error;
            }
          }),
        abort: () =>
          this.queue.run(async () => {
            if (published || this.pending !== pending) return;
            this.failed = true;
            await this.dropPending();
          }),
      };
    });
  }

  private async seal(): Promise<void> {
    this.check();
    if (this.pending) throw new ModuleServiceError('conflict', 'Cache sink is open');
    this.state = 'sealed';
    this.entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const bytes = Buffer.from(JSON.stringify(this.entries));
    if (bytes.length > this.manifestBudget || this.bytes + bytes.length > this.budget.bytes)
      throw new ModuleServiceError('module_quota_exceeded');
    await this.host.room(bytes.length);
    this.host.check();
    this.signal.throwIfAborted();
    const handle = await open(join(this.directory, 'manifest-pending'), 'wx', 0o600);
    this.manifestHandle = handle;
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
      this.manifestHandle = undefined;
    }
    this.host.check();
    await rename(join(this.directory, 'manifest-pending'), join(this.directory, 'manifest'));
    await syncDirectory(this.directory);
    this.manifest = { bytes: bytes.length, hash: createHash('sha256').update(bytes).digest('hex') };
  }

  commit(signal: ModuleSignal): Promise<void> {
    return this.queue.run(async () => {
      signal.throwIfAborted();
      this.signal.throwIfAborted();
      if (this.state === 'committed') return;
      if (this.state === 'building') await this.seal();
      if (this.state !== 'sealed' || !this.manifest) throw new ModuleServiceError('conflict');
      signal.throwIfAborted();
      this.signal.throwIfAborted();
      // Retrying an uncertain commit addresses this same immutable generation.
      await this.host.publish(
        { bytes: this.bytes + this.manifest.bytes, files: this.entries.length + 1 },
        this.manifest.hash,
      );
      this.state = 'committed';
      this.signal.removeEventListener('abort', this.cancel);
      this.host.settled();
    });
  }

  private async dropPending(): Promise<void> {
    if (this.manifestHandle) {
      await this.manifestHandle.close();
      this.manifestHandle = undefined;
    }
    const pending = this.pending;
    if (!pending) return;
    if (!pending.closed) {
      await pending.handle.close();
      pending.closed = true;
    }
    await unlink(pending.path).catch((error: unknown) => {
      if (!hasCode(error, 'ENOENT')) throw error;
    });
    this.pending = undefined;
  }

  abort(): Promise<void> {
    return this.queue.run(async () => {
      if (this.state === 'committed') return;
      this.state = 'aborted';
      this.signal.removeEventListener('abort', this.cancel);
      await this.dropPending();
      await this.host.retire();
      this.host.settled();
    });
  }

  /** Shutdown revokes first and drains native operations even after the PG owner was lost.
   * The caller may mark that owner quiescent only after this succeeds for every handle. */
  async quiesce(): Promise<void> {
    this.state = this.state === 'committed' ? 'committed' : 'aborted';
    this.signal.removeEventListener('abort', this.cancel);
    await this.queue.drain();
    await this.dropPending();
  }
}
