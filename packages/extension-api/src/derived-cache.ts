import type { ModuleSignal } from './descriptor.js';
import type { FileSink } from './module-files.js';
import type { ByteRange, Page } from './portable.js';

/** Non-authoritative, module-private cache groups. Authorize source data on every request;
 * cache handles never grant caller rights. Cache loss must allow regeneration or fallback.
 * Signed api/worker may build; reader may only open; backup receives no service (ADR 0084).
 */
export interface DerivedCache {
  /** Key: 1..256 UTF-8 bytes. Reserve the peak temporary + committed + manifest footprint,
   * not just payload; bytes/files are positive safe integers, files <= 4096. Shared resources
   * quota includes legacy data/cache and all retained generation reservations.
   * Null means another build or insufficient budget. Reader begin throws read_only.
   * No module callback runs under a database lock. Aborting signal invalidates the build.
   */
  begin(
    key: string,
    reserve: { readonly bytes: number; readonly files: number },
    signal: ModuleSignal,
  ): Promise<CacheBuild | null>;
  /** Pin one published generation, or null on miss. Signal must cover the whole response.
   * The caller releases the handle on success, failure and early exit; shutdown/session loss
   * also revoke it. Separate requests reopen and check expected content identities themselves.
   */
  open(key: string, signal: ModuleSignal): Promise<CacheRead | null>;
}

/** Writes only one unique namespace. No paths, rename/remove or access to other generations. */
export interface CacheBuild {
  /** ModuleFiles name rules. Exclusive name, streamed with backpressure; reserved footprint
   * bounds all sinks together. Nothing is discoverable through open before commit.
   */
  create(name: string): Promise<FileSink>;
  /** All sinks must be closed. Atomic PG publication follows completed files and manifest;
   * validates the original owner/fence. Repeating successful commit is idempotent. Ownership
   * loss is terminal; reconnecting cannot revive this handle. Cancellation is checked.
   */
  commit(signal: ModuleSignal): Promise<void>;
  /** Idempotently abandon unpublished work; never unpublish a committed generation.
   * Does not promise immediate quota recovery for a lost owner with uncertain filesystem I/O.
   */
  abort(): Promise<void>;
}

/** A pinned immutable generation; no operation after release or cancellation may succeed. */
export interface CacheRead {
  stat(name: string): Promise<{ readonly size: number } | null>;
  /** Inclusive safe-integer range; malformed/out-of-bounds ranges are invalid_input.
   * Absent file is unavailable. Consume once and close the iterator on early exit.
   */
  read(name: string, range?: ByteRange): AsyncIterable<Uint8Array>;
  /** Opaque cursor, limit 1..1000. Lists only this generation's module files, not its manifest. */
  list(after: string | null, limit: number): Promise<Page<string>>;
  /** Idempotent: stop streams, drain file I/O and close descriptors before releasing the pin. */
  release(): Promise<void>;
}
