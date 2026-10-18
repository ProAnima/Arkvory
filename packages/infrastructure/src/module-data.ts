import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { link, mkdir, open, rename, rm, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ArkvoryError } from '@proanima/arkvory-domain';
import { ModuleServiceError } from '@proanima/arkvory-extension-api';
import type {
  ByteRange,
  FileSink,
  ModuleDataDirectory,
  ModuleDataUsage,
  ModuleFiles,
} from '@proanima/arkvory-extension-api';
import { hasCode, syncDirectory } from './fs-durability.js';
import {
  entryAt,
  listFiles,
  measureTree,
  requireDataName,
  requireInside,
} from './module-data-paths.js';
import { requireVolumeRoom, statVolume } from './volume-space.js';
import type { VolumeProbe, VolumeReserve } from './volume-space.js';

const SPACE_CHECK_BYTES = 64 * 1024 ** 2;
const MAX_LIST = 1000;

/** What one module's directory shares between its two areas: the quota and its accounting. */
interface Shared {
  readonly root: string;
  readonly quotaBytes: number;
  readonly quotaFiles: number;
  readonly reserve: VolumeReserve;
  readonly probe: VolumeProbe;
  readonly readOnly: boolean;
  bytes: number;
  files: number;
  /** Bytes written by open sinks, beyond what they replace. */
  pendingBytes: number;
  /** New files reserved by open sinks. */
  pendingFiles: number;
}

const quotaExceeded = () => new ModuleServiceError('module_quota_exceeded');
const readOnly = () => new ModuleServiceError('read_only');

/** The core's capacity refusal in the module contract; anything else passes. */
async function roomFor(shared: Shared, bytes: number): Promise<void> {
  try {
    await requireVolumeRoom(shared.root, bytes, shared.reserve, shared.probe);
  } catch (error) {
    if (error instanceof ArkvoryError && error.code === 'capacity_exceeded')
      throw new ModuleServiceError('capacity_exceeded');
    throw error;
  }
}

/** A file written to `tmp/` and published under its name by `close`. */
class Sink implements FileSink {
  private written = 0;
  private sinceCheck = 0;
  private done = false;
  constructor(
    private readonly shared: Shared,
    private readonly handle: FileHandle,
    private readonly temporary: string,
    private readonly target: string,
    private readonly options: { readonly durable: boolean; readonly exclusive: boolean },
    /** Size of the file this one replaces when published; it is no longer counted then. */
    private readonly replaces: number,
    private readonly reservedFile: boolean,
  ) {}

  async write(chunk: Uint8Array): Promise<void> {
    if (this.done) throw new ModuleServiceError('conflict', 'File is closed');
    const s = this.shared;
    try {
      if (s.bytes - this.replaces + s.pendingBytes + chunk.byteLength > s.quotaBytes)
        throw quotaExceeded();
      this.sinceCheck += chunk.byteLength;
      if (this.sinceCheck >= SPACE_CHECK_BYTES) {
        await roomFor(s, chunk.byteLength);
        this.sinceCheck = 0;
      }
      s.pendingBytes += chunk.byteLength;
      this.written += chunk.byteLength;
      await this.handle.write(chunk);
    } catch (error) {
      await this.abort();
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.done) throw new ModuleServiceError('conflict', 'File is closed');
    try {
      if (this.options.durable) await this.handle.sync();
      await this.handle.close();
      await mkdir(dirname(this.target), { recursive: true });
      const before = await entryAt(this.target);
      if (this.options.exclusive) await this.linkNew();
      else await rename(this.temporary, this.target);
      if (this.options.durable) await syncDirectory(dirname(this.target));
      this.finish(this.written - (before?.size ?? 0), before ? 0 : 1);
    } catch (error) {
      await this.abort();
      throw error;
    }
  }

  /** An exclusive file never replaces one that appeared since `create`. */
  private async linkNew(): Promise<void> {
    try {
      await link(this.temporary, this.target);
    } catch (error) {
      if (hasCode(error, 'EEXIST')) throw new ModuleServiceError('conflict', 'File exists');
      throw error;
    }
    await unlink(this.temporary);
  }

  /** Releases the reservations and counts what became visible. Runs once. */
  private finish(bytes: number, files: number): void {
    if (this.done) return;
    this.done = true;
    this.shared.pendingBytes -= this.written;
    if (this.reservedFile) this.shared.pendingFiles--;
    this.shared.bytes += bytes;
    this.shared.files += files;
  }

  async abort(): Promise<void> {
    if (this.done) return;
    this.finish(0, 0);
    await this.handle.close().catch(() => undefined);
    await rm(this.temporary, { force: true });
  }
}

/** One area (`data` or `cache`) of a module's directory. */
class AreaFiles implements ModuleFiles {
  constructor(
    private readonly area: string,
    private readonly shared: Shared,
  ) {}

  private async resolve(name: string): Promise<string> {
    const segments = requireDataName(name);
    await requireInside(this.area, segments);
    return join(this.area, ...segments);
  }

  async create(
    name: string,
    options: { readonly durable: boolean; readonly exclusive: boolean },
  ): Promise<FileSink> {
    const s = this.shared;
    if (s.readOnly) throw readOnly();
    const target = await this.resolve(name);
    const existing = await entryAt(target);
    if (existing && (options.exclusive || !existing.isFile()))
      throw new ModuleServiceError('conflict', 'File exists');
    const reservedFile = existing === null;
    if (reservedFile && s.files + s.pendingFiles + 1 > s.quotaFiles) throw quotaExceeded();
    await roomFor(s, 0);
    const temporary = join(s.root, 'tmp', randomUUID());
    await mkdir(dirname(temporary), { recursive: true, mode: 0o700 });
    const handle = await open(temporary, 'wx', 0o600);
    if (reservedFile) s.pendingFiles++;
    return new Sink(s, handle, temporary, target, options, existing?.size ?? 0, reservedFile);
  }

  async *read(name: string, range?: ByteRange): AsyncIterable<Uint8Array> {
    const path = await this.resolve(name);
    const entry = await entryAt(path);
    if (!entry?.isFile()) throw new ModuleServiceError('unavailable', 'No such data file');
    const end = range?.end ?? entry.size - 1;
    if (entry.size === 0 && range === undefined) return;
    if (range && (range.start < 0 || range.start > end || end >= entry.size))
      throw new ModuleServiceError('invalid_input', 'Range outside the file');
    for await (const raw of createReadStream(path, { start: range?.start ?? 0, end })) {
      const chunk: unknown = raw;
      if (!(chunk instanceof Uint8Array)) throw new TypeError('Unexpected file stream chunk');
      yield chunk;
    }
  }

  async stat(name: string): Promise<{ readonly size: number } | null> {
    const entry = await entryAt(await this.resolve(name));
    return entry?.isFile() ? { size: entry.size } : null;
  }

  async rename(from: string, to: string): Promise<void> {
    if (this.shared.readOnly) throw readOnly();
    const source = await this.resolve(from);
    const target = await this.resolve(to);
    if (!(await entryAt(source))?.isFile())
      throw new ModuleServiceError('unavailable', 'No such data file');
    const replaced = await entryAt(target);
    if (replaced && !replaced.isFile()) throw new ModuleServiceError('conflict', 'Target exists');
    await mkdir(dirname(target), { recursive: true });
    await rename(source, target);
    if (replaced) {
      this.shared.bytes -= replaced.size;
      this.shared.files--;
    }
  }

  async remove(name: string): Promise<void> {
    if (this.shared.readOnly) throw readOnly();
    const path = await this.resolve(name);
    const entry = await entryAt(path);
    if (entry === null) return;
    if (!entry.isFile()) throw new ModuleServiceError('invalid_input', 'Not a data file');
    try {
      await unlink(path);
    } catch (error) {
      if (hasCode(error, 'ENOENT')) return;
      throw error;
    }
    this.shared.bytes -= entry.size;
    this.shared.files--;
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
    const { bytes, files, quotaBytes, quotaFiles } = this.shared;
    return { bytes, files, quotaBytes, quotaFiles };
  }
}

export interface ModuleDataOptions {
  /** ARKVORY_DATA_DIR: the directory is `module-data/<id>/` beneath it. */
  readonly dataDirectory: string;
  readonly moduleId: string;
  readonly quota: { readonly bytes: number; readonly files: number };
  readonly reserve: VolumeReserve;
  /** A read gateway: the same files, every change refused with `read_only`. */
  readonly readOnly: boolean;
  readonly probe?: VolumeProbe;
}

export interface ModuleData {
  readonly directory: ModuleDataDirectory;
  /** Counts the files on disk again: the bounded reconciliation of the accounting. */
  reconcile(): Promise<void>;
}

/**
 * A module's data directory on the data volume (ADR 0083, N6): `data/` (part of backups),
 * `cache/` (not) and `tmp/` for files being written, all private to the service account. The
 * writer creates them and drops leftover temporary files of a crash; a gateway creates nothing.
 * Every write is counted at once against one quota for both areas; `reconcile` corrects the
 * counts from the disk (writes outside the port, crashes).
 */
export async function openModuleData(options: ModuleDataOptions): Promise<ModuleData> {
  const root = join(options.dataDirectory, 'module-data', options.moduleId);
  const shared: Shared = {
    root,
    quotaBytes: options.quota.bytes,
    quotaFiles: options.quota.files,
    reserve: options.reserve,
    probe: options.probe ?? statVolume,
    readOnly: options.readOnly,
    bytes: 0,
    files: 0,
    pendingBytes: 0,
    pendingFiles: 0,
  };
  if (!options.readOnly) {
    for (const area of ['data', 'cache', 'tmp'])
      await mkdir(join(root, area), { recursive: true, mode: 0o700 });
    await rm(join(root, 'tmp'), { recursive: true, force: true });
    await mkdir(join(root, 'tmp'), { mode: 0o700 });
  }
  const reconcile = async () => {
    const [data, cache] = await Promise.all([
      measureTree(join(root, 'data')),
      measureTree(join(root, 'cache')),
    ]);
    shared.bytes = data.bytes + cache.bytes;
    shared.files = data.files + cache.files;
  };
  await reconcile();
  return {
    directory: {
      data: new AreaFiles(join(root, 'data'), shared),
      cache: new AreaFiles(join(root, 'cache'), shared),
    },
    reconcile,
  };
}
