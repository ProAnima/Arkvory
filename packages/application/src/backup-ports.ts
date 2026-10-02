import type {
  BackupFailureCode,
  BackupManifest,
  BackupPhase,
  ExcludedTable,
  InventoryEntry,
  PointFile,
  VaultIdentity,
} from '@proanima/arkvory-domain';
import type { Cancellation } from './ports.js';

/**
 * Ownership of one capture attempt. throwIfAborted fails with `lease_lost` once renewal lapsed
 * locally; every store write is additionally fenced by the generation in the database.
 */
export interface CaptureLease extends Cancellation {
  readonly jobId: string;
  readonly pointId: string;
  readonly generation: number;
  readonly attempt: number;
  /** Stops renewal; an unfinished stored lease then expires and may be fenced. Idempotent. */
  close(): Promise<void>;
}

export type CaptureStart =
  | { readonly kind: 'started'; readonly lease: CaptureLease }
  | { readonly kind: 'completed'; readonly jobId: string; readonly pointId: string };

export interface CaptureJobs {
  /**
   * Creates the job of a new idempotency key or reuses the existing one: a completed job is
   * returned, a live one is busy, a stale one is fenced (interrupted, pins released, barrier
   * reopened) before a new attempt. At most one capture is active per database.
   */
  start(request: {
    idempotencyKey: string;
    vaultId: string;
    jobId: string;
    pointId: string;
  }): Promise<CaptureStart>;
  advance(lease: CaptureLease, phase: BackupPhase): Promise<void>;
  /** running → committing. From here on an attempt is reconciled, never declared failed. */
  committing(lease: CaptureLease, snapshotAt: string | null): Promise<void>;
  /** committing → completed, releasing the job pins in the same transaction. */
  complete(lease: CaptureLease): Promise<void>;
  /** running → failed; pins are released and a barrier held by the attempt is reopened. */
  fail(lease: CaptureLease, code: BackupFailureCode): Promise<void>;
}

export interface UnlinkBarrier {
  /** Waits, bounded, for already admitted unlinks, then durably refuses new admissions. */
  close(lease: CaptureLease): Promise<void>;
  /** Caller guarantees every pin of the attempt is committed before reopening. */
  reopen(lease: CaptureLease): Promise<void>;
}

export interface CapturePins {
  /** Durable when it resolves. An inventory entry may be written only after its pin. */
  pin(lease: CaptureLease, ids: readonly string[]): Promise<void>;
}

/** One read-only database snapshot T. It must be closed before content is copied. */
export interface SnapshotSession {
  readonly takenAt: string;
  readonly exportedId: string;
  readonly schemaVersion: number;
  readonly postgresMajor: number;
  readonly sourceInstanceId: string;
  readonly pendingUploads: number;
  /** Exported tables in their foreign-key-safe load order. */
  readonly tables: readonly string[];
  readonly excludedTables: readonly ExcludedTable[];
  /** Keyset page of content published at T, ordered by id. */
  inventory(after: string | undefined, limit: number): Promise<readonly InventoryEntry[]>;
  /** NDJSON lines of one table in a stable order, read through a bounded cursor. */
  rows(table: string): AsyncIterable<string>;
  /** Ends the snapshot transaction; idempotent. */
  close(): Promise<void>;
}
export interface SnapshotSource {
  /** Opens T after the barrier closed; refuses an unexpected schema or an unknown table. */
  open(lease: CaptureLease): Promise<SnapshotSession>;
}

export interface ContentSource {
  /** Exact bytes of pinned published content; a missing file fails with `blob_missing`. */
  read(entry: InventoryEntry): AsyncIterable<Uint8Array>;
}

export interface FileDigest extends PointFile {
  readonly lines: number;
}

/** Files of an attempt are invisible until commit and never alter a committed point. */
export interface StagedPoint {
  write(
    name: string,
    lines: AsyncIterable<string>,
    cancellation: Cancellation,
  ): Promise<FileDigest>;
  lines(name: string, cancellation: Cancellation): AsyncIterable<string>;
  /** Atomic publication; `exists` when this point id was already committed by another attempt. */
  commit(manifest: BackupManifest): Promise<'committed' | 'exists'>;
  /** Removes leftovers of this attempt; idempotent. */
  discard(): Promise<void>;
}

export interface VaultPoints {
  /** Refuses a directory without a valid vault.json (`vault_missing`). */
  identity(): Promise<VaultIdentity>;
  /** A committed point, or null; staged attempts are never returned. */
  point(pointId: string): Promise<BackupManifest | null>;
}
export interface CaptureVault extends VaultPoints {
  stage(pointId: string, attempt: number): Promise<StagedPoint>;
  /** Content is stored once per id and shared by every point that lists it. */
  hasBlob(entry: InventoryEntry): Promise<boolean>;
  /** Streams with backpressure; size and SHA-256 are verified before the atomic rename. */
  putBlob(
    entry: InventoryEntry,
    source: AsyncIterable<Uint8Array>,
    cancellation: Cancellation,
  ): Promise<void>;
}
export interface ReadableVault extends VaultPoints {
  /** Names of committed point directories, bounded; each is validated by point(). */
  pointIds(): Promise<readonly string[]>;
  /** Null when the file is absent. */
  digest(pointId: string, name: string, cancellation: Cancellation): Promise<FileDigest | null>;
  /** Lines of a point file; the iteration fails at its end when the digest differs. */
  lines(
    pointId: string,
    name: string,
    expected: PointFile,
    cancellation: Cancellation,
  ): AsyncIterable<string>;
  hasBlob(entry: InventoryEntry): Promise<boolean>;
  /** SHA-256 of stored content; null when it is absent or has another size. */
  blobDigest(entry: InventoryEntry, cancellation: Cancellation): Promise<string | null>;
  readBlob(entry: InventoryEntry): AsyncIterable<Uint8Array>;
}

export interface RestoreTableSource {
  readonly name: string;
  readonly rows: number;
  /** Re-readable; every pass is verified against the manifest digest. */
  lines(): AsyncIterable<string>;
}
export interface RestoreNormalization {
  readonly cancelledUploads: number;
  readonly failedJobs: number;
  readonly droppedPromotions: number;
  readonly revokedTokens: number;
  readonly revokedServiceKeys: number;
  readonly disabledPolicies: number;
}
export interface RestoreDatabase {
  /** Refuses with `target_not_empty` when the target schema has any Arkvory table. */
  requireEmpty(): Promise<void>;
  /** Migrations up to the backup schema only. */
  prepare(schemaVersion: number): Promise<void>;
  /**
   * One transaction: known tables in foreign-key-safe order, identity sequences, versioned
   * normalization and the storage binding. Nothing is visible when it fails.
   */
  load(
    input: {
      schemaVersion: number;
      pointId: string;
      storageId: string;
      restoredAt: string;
      tables: readonly RestoreTableSource[];
    },
    cancellation: Cancellation,
  ): Promise<RestoreNormalization & { readonly rows: number }>;
  /** Remaining migrations of this release, after the load committed. */
  finish(): Promise<void>;
}
export interface RestoreStorage {
  /** Refuses with `target_not_empty` unless the directory is absent or empty. */
  requireEmpty(): Promise<void>;
  /** Creates the storage layout and its new identity. */
  prepare(): Promise<string>;
  /** Verifies size and SHA-256 before the content becomes visible. */
  put(
    entry: InventoryEntry,
    source: AsyncIterable<Uint8Array>,
    cancellation: Cancellation,
  ): Promise<void>;
}
