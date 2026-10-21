/** An immutable physical file in a module's logical resource. ADR 0089. */
export interface ResourceFile {
  readonly key: string;
  readonly name: string;
  /** Module-owned opaque metadata, at most 8192 bytes. Never an authorization claim. */
  readonly metadata: Uint8Array;
  readonly sources: readonly string[];
}

/** Shared durable references, scoped by the host to one signed module. Keys and owners are
 * opaque strings of 1..256 UTF-8 bytes; batches contain at most 1024 distinct keys.
 * References precede file I/O and survive process/session loss. They have no expiry.
 * Reader/backup instances may only find. This service grants no content access.
 */
export interface ResourceCatalog {
  /** False after migration/restore. Import ALL durable recipes and resource files before initialize.
   * Initial adoption requires a stopped old module deployment; mixed old/new writers are forbidden. */
  ready(): Promise<boolean>;
  /** Reconstruct an existing physical file while uninitialized. Does not create or change bytes. */
  restore(file: ResourceFile): Promise<void>;
  /** Enable collection after a complete successful reconciliation. Missing source files refuse it. */
  initialize(): Promise<void>;
  /** Retain resources for an upload before using them. Retired resources return busy;
   * a closed owner returns conflict and can never be reopened by a delayed writer. */
  retain(owner: string, keys: readonly string[]): Promise<void>;
  /** Register a unique immutable file BEFORE creating it. Sources must have published files.
   * Atomically retains this resource and its sources for owner. Replay must match exactly. */
  reserve(owner: string, file: ResourceFile): Promise<void>;
  /** Call only after durable file close. Uncertain success may be retried. */
  publish(owner: string, name: string): Promise<void>;
  /** One published file of a live resource, or null. Retain before using it for a new owner. */
  find(key: string): Promise<ResourceFile | null>;
  /** Core cleanup scope only, after that owner's I/O is quiescent and its recipe removed.
   * Idempotently closes owner forever; callers must never reuse upload identities.
   * Large owners release at most 32768 references per call; busy requests a retry. */
  release(owner: string): Promise<void>;
  /** Core performs bounded physical deletion under reader/backup protection, never in a module
   * callback. Grace is installation DB time; 0..90 days, limit 1..1000 physical files per pass.
   * Failed unlink remains retryable. Does not collect before initialize. */
  collect(graceMs: number, limit: number): Promise<number>;
}
