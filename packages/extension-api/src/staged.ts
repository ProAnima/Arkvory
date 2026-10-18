import type { ModuleSignal } from './descriptor.js';
import type { BlobDescriptor, ByteRange, PartRef } from './portable.js';

/**
 * Completion of a multipart upload from parts the storage already accepted (ADR 0083, N1): an
 * optional capability of a storage instance that can assemble an object on its own side, so the
 * object does not pass through the core a second time.
 *
 * The core never takes the size or hash the storage measures: it reads every byte of the
 * composed object itself, then calls `commit`, and publishes in its catalog only after that.
 */
export interface StagedCompletion {
  /**
   * Assembles an object that is not visible yet from the accepted parts, in order. Repeating it
   * for the same id is idempotent, also after a commit: the committed object is returned, so a
   * crash between commit and catalog publication is retried by checking it again. A storage in
   * `read-only` mode refuses with `read_only`; the core then completes in its own storage.
   */
  compose(id: string, parts: readonly PartRef[], signal: ModuleSignal): Promise<StagedObject>;
}

/** An assembled object; parts stay until the core publishes and its cleanup collects them. */
export interface StagedObject {
  /** The size of the assembled bytes as the storage sees it; the core checks it while reading. */
  readonly size: number;
  /** The bytes of the future object, exactly the range asked for. */
  read(range?: ByteRange): AsyncIterable<Uint8Array>;
  /**
   * Makes the object published and durable: it is immutable afterwards and survives the failures
   * the storage declares. Repeating it after success succeeds. It publishes exactly the bytes
   * `read` gave the core, which checked them: the core cannot read them a second time, so a
   * storage whose accepted parts can still change after `compose` holds them fixed until the
   * commit (by content address, version or snapshot) or refuses it with `integrity_mismatch`.
   */
  commit(expected: BlobDescriptor, signal: ModuleSignal): Promise<void>;
  /**
   * Drops an assembled object that was not committed, never the parts; idempotent, safe after a
   * failed commit, and nothing at all after a successful one (a committed object is immutable).
   */
  discard(): Promise<void>;
}
