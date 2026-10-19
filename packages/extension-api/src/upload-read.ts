import type { AccessScope, ContentRef } from './catalog-read.js';
import type { ModuleSignal } from './descriptor.js';
import type { ByteRange } from './portable.js';

export interface UploadView {
  readonly repository: string;
  readonly id: string;
  readonly state: 'pending';
  readonly backendId: string;
  readonly size: number;
  readonly sha256: string;
}

/** Accepted multipart bytes only. Neither uncommitted writes nor published content. */
export interface UploadRead {
  /** Null for absent, expired, non-pending, foreign or unauthorized uploads alike. */
  upload(scope: AccessScope, repository: string, id: string): Promise<UploadView | null>;
  /**
   * Requires upload.read and ownership for every principal in scope. Inclusive safe-integer
   * range, wholly covered by accepted parts; holes are conflict. No existence oracle: absent
   * or inaccessible uploads give an empty stream. Malformed ranges are always invalid_input.
   * Reads begin lazily and hold a shared upload lock until completion/cancellation, excluding
   * writes, completion and cleanup (busy). Consume once, close on early exit. Checks signal,
   * scope lifetime and lock ownership before and after each storage chunk; memory is bounded.
   */
  read(
    scope: AccessScope,
    ref: ContentRef,
    range: ByteRange,
    signal: ModuleSignal,
  ): AsyncIterable<Uint8Array>;
}
