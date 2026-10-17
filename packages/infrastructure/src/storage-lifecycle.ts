/**
 * Lifecycle of one storage instance beside its `BlobStore` port (ADR 0079, 5.1; ADR 0083, N9):
 * what a process does with a storage before and around reading and writing blobs.
 */
export interface StorageLifecycle {
  /** Creates the layout of a writable storage; repeating it is harmless. */
  initialize(): Promise<void>;
  /** The storage's own id, created on first use unless `readOnly`. */
  identity(readOnly?: boolean): Promise<string>;
  /** Fails unless the storage's layout exists (a read gateway does not create it). */
  ready(): Promise<void>;
  /** Fails with `capacity_exceeded` unless `bytes` more fit beside the reserve. */
  checkSpace(bytes: number): Promise<void>;
  /** Fails with `conflict` unless the storage holds nothing yet: a restore target. */
  requireEmpty(): Promise<void>;
}
