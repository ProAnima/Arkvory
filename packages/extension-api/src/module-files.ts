import type { ByteRange, Page } from './portable.js';

/** A file being written; nothing is visible under its name before `close` succeeds. */
export interface FileSink {
  /**
   * Appends bytes. Refused with `module_quota_exceeded` beyond the module's quota, with
   * `capacity_exceeded` when the volume would cross the core's reserve of bytes or inodes; the
   * file is then aborted.
   */
  write(chunk: Uint8Array): Promise<void>;
  /**
   * Publishes the file under its name: atomically, replacing an existing file unless the sink
   * was created `exclusive` (then `conflict`). A `durable` file and its directory are synced
   * first (the directory not on Windows, ADR 0004).
   */
  close(): Promise<void>;
  /** Drops what was written; idempotent, also after a failed write or close. */
  abort(): Promise<void>;
}

/**
 * Files of one area of a module's data directory (ADR 0083, N6). Names are relative paths of
 * the asset path rules: no `..`, no absolute path, no backslash, no link; the core keeps the
 * files private (0600). The module gets a port, never a path, so every write is counted against
 * its quota at once. A read gateway sees the same files read-only: every change is `read_only`.
 */
export interface ModuleFiles {
  create(
    name: string,
    options: { readonly durable: boolean; readonly exclusive: boolean },
  ): Promise<FileSink>;
  /** The bytes of a file; an absent one is `unavailable`. */
  read(name: string, range?: ByteRange): AsyncIterable<Uint8Array>;
  stat(name: string): Promise<{ readonly size: number } | null>;
  /** Atomic within the area; replaces an existing target. */
  rename(from: string, to: string): Promise<void>;
  /** Idempotent. */
  remove(name: string): Promise<void>;
  /** Names under `prefix` in byte order after `after`; at most `limit` (1 to 1000). */
  list(prefix: string, after: string | null, limit: number): Promise<Page<string>>;
  /** The module's whole directory, both areas: what the quota counts. */
  usage(): ModuleDataUsage;
}

export interface ModuleDataUsage {
  readonly bytes: number;
  readonly files: number;
  readonly quotaBytes: number;
  readonly quotaFiles: number;
}

/**
 * The module's data directory (service `data-directory`): `data` is part of backups, `cache` is
 * not and the core may empty it. One quota covers both. Removing a module keeps the directory;
 * only an explicit command removes it.
 */
export interface ModuleDataDirectory {
  readonly data: ModuleFiles;
  readonly cache: ModuleFiles;
}
