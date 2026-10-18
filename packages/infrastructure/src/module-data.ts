import { randomUUID } from 'node:crypto';
import { link, lstat, mkdir, open, rename, rm, unlink } from 'node:fs/promises';
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
/** Windows refuses to replace a file another handle holds open; readers hold it briefly. */
const SHARING_ATTEMPTS = 5;
const SHARING_DELAY_MS = 20;

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
  /** Tail of the changes of published names and of the reconciliation; see `exclusive`. */
  queue: Promise<void>;
}

/** A name resolved inside an area: its path and the folders above it. */
interface Place {
  readonly area: string;
  readonly folders: readonly string[];
  readonly path: string;
}

const quotaExceeded = () => new ModuleServiceError('module_quota_exceeded');
const readOnly = () => new ModuleServiceError('read_only');
const closed = () => new ModuleServiceError('conflict', 'File is closed');
const noFile = () => new ModuleServiceError('unavailable', 'No such data file');

/**
 * Runs `work` after every earlier change of the directory. A publish, rename or removal reads
 * what the target holds, changes it and counts the change as one step, so two of them never
 * count against the same old file; the reconciliation's walk never sees a change half counted.
 * A failure of `work` reaches its caller only, never the next in line.
 */
function exclusive<T>(shared: Shared, work: () => Promise<T>): Promise<T> {
  const run = shared.queue.then(work);
  shared.queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

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

const pause = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Replaces or links a published name. On Windows the replacement fails while another handle
 * (a reader, a gateway, an antivirus scan) holds the old file open: retried a bounded number
 * of times with a growing pause, then `unavailable`. The caller holds the directory's lock.
 */
async function publishing(step: () => Promise<void>): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await step();
      return;
    } catch (error) {
      const held =
        process.platform === 'win32' &&
        (hasCode(error, 'EPERM') || hasCode(error, 'EACCES') || hasCode(error, 'EBUSY'));
      if (!held) throw error;
      if (attempt >= SHARING_ATTEMPTS)
        throw new ModuleServiceError('unavailable', 'Data file is in use');
      await pause(SHARING_DELAY_MS * 2 ** (attempt - 1));
    }
  }
}

/** Whether two names lead to one file: the same name, another case or an 8.3 alias. */
async function sameFile(a: string, b: string): Promise<boolean> {
  const [first, second] = await Promise.all([
    lstat(a, { bigint: true }),
    lstat(b, { bigint: true }),
  ]);
  return first.dev === second.dev && first.ino === second.ino;
}

/**
 * Creates the folders above a name, private to the service account. A durable file also syncs
 * the parent of each level it creates, so the new entry survives a crash with the file.
 */
async function makeFolders(place: Place, durable: boolean): Promise<void> {
  let parent = place.area;
  for (const segment of place.folders) {
    const folder = join(parent, segment);
    try {
      await mkdir(folder, { mode: 0o700 });
      if (durable) await syncDirectory(parent);
    } catch (error) {
      if (!hasCode(error, 'EEXIST')) throw error;
    }
    parent = folder;
  }
}

type SinkState = 'open' | 'closing' | 'done';

/** A file written to `tmp/` and published under its name by `close`. */
class Sink implements FileSink {
  private written = 0;
  private sinceCheck = 0;
  private state: SinkState = 'open';
  constructor(
    private readonly shared: Shared,
    private readonly handle: FileHandle,
    private readonly temporary: string,
    private readonly target: Place,
    private readonly options: { readonly durable: boolean; readonly exclusive: boolean },
    /** Size the name held at `create`: credited to the writes, checked again by `close`. */
    private readonly replaces: number,
    private readonly reservedFile: boolean,
  ) {}

  async write(chunk: Uint8Array): Promise<void> {
    if (this.state !== 'open') throw closed();
    const s = this.shared;
    const size = chunk.byteLength;
    if (s.bytes - this.replaces + s.pendingBytes + size > s.quotaBytes) {
      await this.abort();
      throw quotaExceeded();
    }
    // Reserved before any await, so concurrent writes see each other; `finish` releases it.
    s.pendingBytes += size;
    this.written += size;
    this.sinceCheck += size;
    try {
      if (this.sinceCheck >= SPACE_CHECK_BYTES) {
        await roomFor(s, size);
        this.sinceCheck = 0;
      }
      // An abort or close may have run during the volume check.
      if (!this.open()) throw closed();
      await this.handle.write(chunk);
    } catch (error) {
      await this.abort();
      throw error;
    }
  }

  /** Read through a method: the state changes while a write awaits. */
  private open(): boolean {
    return this.state === 'open';
  }

  async close(): Promise<void> {
    if (this.state !== 'open') throw closed();
    this.state = 'closing';
    try {
      if (this.options.durable) await this.handle.sync();
      await this.handle.close();
      await makeFolders(this.target, this.options.durable);
      await exclusive(this.shared, () => this.publish());
    } catch (error) {
      await this.discard();
      throw error;
    }
  }

  /** Under the directory's lock: the quota against what the name holds now, then the publish. */
  private async publish(): Promise<void> {
    const s = this.shared;
    const target = this.target.path;
    const before = await entryAt(target);
    if (before && (this.options.exclusive || !before.isFile()))
      throw new ModuleServiceError('conflict', 'File exists');
    const replaced = before?.size ?? 0;
    // The name may have been removed or replaced since `create` credited its old size.
    if (s.bytes - replaced + this.written > s.quotaBytes) throw quotaExceeded();
    if (!before && !this.reservedFile && s.files + s.pendingFiles + 1 > s.quotaFiles)
      throw quotaExceeded();
    if (this.options.exclusive) {
      // `link` never replaces a name that appeared behind the port.
      await publishing(() => this.linkNew());
      // The leftover name is in `tmp/`, which the next writer empties; the file is published.
      await unlink(this.temporary).catch(() => undefined);
    } else await publishing(() => rename(this.temporary, target));
    this.finish(this.written - replaced, before ? 0 : 1);
    if (this.options.durable) await syncDirectory(dirname(target));
  }

  private async linkNew(): Promise<void> {
    try {
      await link(this.temporary, this.target.path);
    } catch (error) {
      if (hasCode(error, 'EEXIST')) throw new ModuleServiceError('conflict', 'File exists');
      throw error;
    }
  }

  /** Releases the reservations and counts what became visible. Runs once. */
  private finish(bytes: number, files: number): void {
    if (this.state === 'done') return;
    this.state = 'done';
    this.shared.pendingBytes -= this.written;
    if (this.reservedFile) this.shared.pendingFiles--;
    this.shared.bytes += bytes;
    this.shared.files += files;
  }

  async abort(): Promise<void> {
    // A close in progress publishes or discards the file itself.
    if (this.state !== 'open') return;
    await this.discard();
  }

  private async discard(): Promise<void> {
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
    if (s.readOnly) throw readOnly();
    const target = await this.resolve(name);
    const existing = await entryAt(target.path);
    if (existing && (options.exclusive || !existing.isFile()))
      throw new ModuleServiceError('conflict', 'File exists');
    const reservedFile = existing === null;
    if (reservedFile) {
      if (s.files + s.pendingFiles + 1 > s.quotaFiles) throw quotaExceeded();
      // Reserved before any await, so concurrent creates cannot all pass the check.
      s.pendingFiles++;
    }
    try {
      await roomFor(s, 0);
      const temporary = join(s.root, 'tmp', randomUUID());
      await mkdir(dirname(temporary), { recursive: true, mode: 0o700 });
      const handle = await open(temporary, 'wx', 0o600);
      return new Sink(s, handle, temporary, target, options, existing?.size ?? 0, reservedFile);
    } catch (error) {
      if (reservedFile) s.pendingFiles--;
      throw error;
    }
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
    if (s.readOnly) throw readOnly();
    const source = (await this.resolve(from)).path;
    const target = await this.resolve(to);
    await makeFolders(target, false);
    await exclusive(s, async () => {
      if (!(await entryAt(source))?.isFile()) throw noFile();
      const replaced = await entryAt(target.path);
      if (replaced && !replaced.isFile()) throw new ModuleServiceError('conflict', 'Target exists');
      // Checked before the move: afterwards both names may lead to the moved file.
      const counted = replaced !== null && !(await sameFile(source, target.path));
      await publishing(() => rename(source, target.path));
      if (replaced && counted) {
        s.bytes -= replaced.size;
        s.files--;
      }
    });
  }

  async remove(name: string): Promise<void> {
    const s = this.shared;
    if (s.readOnly) throw readOnly();
    const { path } = await this.resolve(name);
    await exclusive(s, async () => {
      const entry = await entryAt(path);
      if (entry === null) return;
      if (!entry.isFile()) throw new ModuleServiceError('invalid_input', 'Not a data file');
      try {
        await unlink(path);
      } catch (error) {
        if (hasCode(error, 'ENOENT')) return;
        throw error;
      }
      s.bytes -= entry.size;
      s.files--;
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
    queue: Promise.resolve(),
  };
  if (!options.readOnly) {
    for (const area of ['data', 'cache', 'tmp'])
      await mkdir(join(root, area), { recursive: true, mode: 0o700 });
    await rm(join(root, 'tmp'), { recursive: true, force: true });
    await mkdir(join(root, 'tmp'), { mode: 0o700 });
  }
  // Under the lock: a change counted during the walk would be overwritten by its result.
  const reconcile = () =>
    exclusive(shared, async () => {
      const [data, cache] = await Promise.all([
        measureTree(join(root, 'data')),
        measureTree(join(root, 'cache')),
      ]);
      shared.bytes = data.bytes + cache.bytes;
      shared.files = data.files + cache.files;
    });
  await reconcile();
  return {
    directory: {
      data: new AreaFiles(join(root, 'data'), shared),
      cache: new AreaFiles(join(root, 'cache'), shared),
    },
    reconcile,
  };
}
