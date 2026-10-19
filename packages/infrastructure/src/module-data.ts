import { randomUUID } from 'node:crypto';
import { open, rename, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { ModuleServiceError } from '@proanima/arkvory-extension-api';
import type {
  ByteRange,
  FileSink,
  ModuleDataDirectory,
  ModuleDataUsage,
  ModuleFiles,
} from '@proanima/arkvory-extension-api';
import { hasCode } from './fs-durability.js';
import { entryAt, listFiles, requireDataName, requireInside } from './module-data-paths.js';
import { ModuleDataAccounting } from './module-data-accounting.js';
import type { ModuleDataOptions } from './module-data-accounting.js';
import { ModuleDataSink, makeFolders, publishing } from './module-data-sink.js';
import type { Place } from './module-data-sink.js';
export type { ModuleDataOptions } from './module-data-accounting.js';
const MAX_LIST = 1000;
const readOnly = () => new ModuleServiceError('read_only');
const noFile = () => new ModuleServiceError('unavailable', 'No such data file');
/** One area (`data` or `cache`) of a module's directory. */
class AreaFiles implements ModuleFiles {
  constructor(
    private readonly area: string,
    private readonly shared: ModuleDataAccounting,
    private readonly requireRemoval?: () => void,
  ) {}

  private async resolve(name: string): Promise<Place> {
    const segments = requireDataName(name);
    await requireInside(this.area, segments);
    return { area: this.area, folders: segments.slice(0, -1), path: join(this.area, ...segments) };
  }

  async create(
    name: string,
    options: { readonly durable: boolean; readonly exclusive: boolean },
  ): Promise<FileSink> {
    const s = this.shared;
    if (s.options.readOnly) throw readOnly();
    return s.run(async (guard) => {
      const target = await this.resolve(name);
      const existing = await entryAt(target.path);
      if (existing && (options.exclusive || !existing.isFile()))
        throw new ModuleServiceError('conflict', 'File exists');
      if (existing) this.requireRemoval?.();
      await s.quota(target.path, 0, 1);
      await s.room(0);
      guard.check();
      const temporary = join(s.temporary, randomUUID());
      await s.ledger.track(temporary, true);
      guard.check();
      const handle = await open(temporary, 'wx', 0o600);
      const sink = new ModuleDataSink(s, handle, temporary, target, options, this.requireRemoval);
      s.sinks.add(sink);
      return sink;
    });
  }

  /** The bytes of one version of the file: the range is checked against the opened file. */
  async *read(name: string, range?: ByteRange): AsyncIterable<Uint8Array> {
    const { path } = await this.resolve(name);
    let handle: FileHandle;
    try {
      handle = await open(path, 'r');
    } catch (error) {
      if (hasCode(error, 'ENOENT') || hasCode(error, 'ENOTDIR') || hasCode(error, 'EISDIR'))
        throw noFile();
      throw error;
    }
    try {
      const entry = await handle.stat();
      if (!entry.isFile()) throw noFile();
      if (entry.size === 0 && range === undefined) return;
      const start = range?.start ?? 0;
      const end = range?.end ?? entry.size - 1;
      if (
        range &&
        (!Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end) ||
          start < 0 ||
          start > end ||
          end >= entry.size)
      )
        throw new ModuleServiceError('invalid_input', 'Range outside the file');
      for await (const raw of handle.createReadStream({ start, end, autoClose: false })) {
        const chunk: unknown = raw;
        if (!(chunk instanceof Uint8Array)) throw new TypeError('Unexpected file stream chunk');
        yield chunk;
      }
    } finally {
      await handle.close();
    }
  }

  async stat(name: string): Promise<{ readonly size: number } | null> {
    const entry = await entryAt((await this.resolve(name)).path);
    return entry?.isFile() ? { size: entry.size } : null;
  }

  async rename(from: string, to: string): Promise<void> {
    const s = this.shared;
    if (s.options.readOnly) throw readOnly();
    await s.run(async (guard) => {
      const source = (await this.resolve(from)).path;
      const target = await this.resolve(to);
      if (!(await entryAt(source))?.isFile()) throw noFile();
      const replaced = await entryAt(target.path);
      if (replaced && !replaced.isFile()) throw new ModuleServiceError('conflict', 'Target exists');
      await s.ledger.track(source);
      await s.ledger.track(target.path);
      this.requireRemoval?.();
      await makeFolders(target, false, guard);
      await publishing(async () => {
        guard.check();
        this.requireRemoval?.();
        await rename(source, target.path);
      });
    });
  }

  async remove(name: string): Promise<void> {
    const s = this.shared;
    if (s.options.readOnly) throw readOnly();
    await s.run(async (guard) => {
      const { path } = await this.resolve(name);
      this.requireRemoval?.();
      const entry = await entryAt(path);
      if (entry === null) return;
      if (!entry.isFile()) throw new ModuleServiceError('invalid_input', 'Not a data file');
      await s.ledger.track(path);
      guard.check();
      this.requireRemoval?.();
      await unlink(path);
    });
  }

  async list(prefix: string, after: string | null, limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIST)
      throw new ModuleServiceError('invalid_input', 'Invalid list limit');
    // The folder part of the prefix is a name like any other; the rest only filters.
    const cut = prefix.lastIndexOf('/');
    const folder = cut < 0 ? [] : requireDataName(prefix.slice(0, cut));
    if (folder.length > 0) await requireInside(this.area, folder);
    const items = await listFiles(this.area, folder, prefix, after, limit + 1);
    const page = items.slice(0, limit);
    return { items: page, next: items.length > limit ? (page.at(-1) ?? null) : null };
  }

  usage(): ModuleDataUsage {
    const {
      bytes,
      files,
      options: { quota },
    } = this.shared;
    const { bytes: quotaBytes, files: quotaFiles } = quota;
    return { bytes, files, quotaBytes, quotaFiles };
  }
}

export interface ModuleData {
  readonly directory: ModuleDataDirectory;
  reconcile(): Promise<void>;
  close(): Promise<void>;
}

/** Writable handles share PostgreSQL admission and disk-backed reservations. */
export async function openModuleData(options: ModuleDataOptions): Promise<ModuleData> {
  const shared = new ModuleDataAccounting(options);
  await shared.initialize();
  return {
    directory: {
      data: new AreaFiles(join(shared.root, 'data'), shared, options.requireRemoval),
      cache: new AreaFiles(join(shared.root, 'cache'), shared),
    },
    reconcile: () => shared.reconcile(),
    close: () => shared.close(),
  };
}
