import type {
  BackupFailureCode,
  BackupManifest,
  BackupRequestKind,
  VaultIdentity,
  VerifyDepth,
} from '@proanima/arkvory-domain';
import type { Cancellation } from './ports.js';
import type { ReadableVault } from './backup-ports.js';
import type { CaptureResult } from './backup-capture.js';
import type { BackupPointRecord, StoredBackupPlan } from './backup-control-ports.js';

/*
 * Ports of the supervised backup agent (ADR 0056). Every write takes the agent lease: the
 * adapter refuses it unless this owner still holds the database lease under the same fencing
 * generation, so an agent that lost its lease cannot change requests, the plan or the catalog.
 */

export interface AgentLease extends Cancellation {
  readonly owner: string;
  readonly generation: number;
  /** False once renewal failed or the local share of the lease ran out; final. */
  readonly active: boolean;
}

export interface ClaimedRequest {
  readonly id: string;
  readonly kind: BackupRequestKind;
  readonly pointId: string | null;
  readonly depth: VerifyDepth | null;
  /** Claims so far, this one included. */
  readonly attempts: number;
}
export interface RequestProgress {
  readonly phase: string;
  readonly bytesDone: bigint;
  readonly bytesTotal: bigint;
  readonly blobsDone: number;
  readonly blobsTotal: number;
}
export interface AgentQueue {
  /**
   * Oldest queued request, or a running one an earlier generation abandoned; it becomes
   * running under this lease. One agent holds the lease, so one request runs at a time.
   */
  claim(lease: AgentLease): Promise<ClaimedRequest | null>;
  /** Links the capture job that executes a request. */
  attach(lease: AgentLease, id: string, jobId: string): Promise<void>;
  progress(lease: AgentLease, id: string, progress: RequestProgress): Promise<void>;
  finish(
    lease: AgentLease,
    id: string,
    outcome: { readonly failed: BackupFailureCode | null; readonly pointId: string | null },
  ): Promise<void>;
  /** Back to queued, for a retry after shutdown or contention. */
  requeue(lease: AgentLease, id: string): Promise<void>;
  /** Follow-up work of the agent itself; false when its key already exists. */
  followUp(
    lease: AgentLease,
    request: {
      readonly id: string;
      readonly kind: BackupRequestKind;
      readonly pointId: string | null;
      readonly depth: VerifyDepth | null;
      readonly key: string;
    },
  ): Promise<boolean>;
}

export interface AgentPlan {
  read(): Promise<StoredBackupPlan>;
  /**
   * One transaction: the slot becomes the last consumed one and its capture is queued. False
   * when an equal or later slot was consumed already, or the plan left `revision` (disabled or
   * edited), so a slot runs at most once and only for the plan it was computed from.
   */
  consume(
    lease: AgentLease,
    slot: number,
    request: { readonly id: string; readonly key: string; readonly revision: number },
  ): Promise<boolean>;
}

export interface CatalogEntry {
  readonly manifest: BackupManifest;
  readonly newBytes: string;
}
export interface AgentCatalog {
  /**
   * Makes the catalog follow the vault: inserts `added`, marks `damaged` rows as failed
   * verification, and marks live rows of the vault outside `present` and `damaged` forgotten.
   * Existing rows keep their pins, verification results and forgotten marks.
   */
  reconcile(
    lease: AgentLease,
    vaultId: string,
    change: {
      readonly added: readonly CatalogEntry[];
      readonly present: readonly string[];
      readonly damaged: readonly string[];
    },
  ): Promise<void>;
  record(lease: AgentLease, entry: CatalogEntry): Promise<void>;
  verified(
    lease: AgentLease,
    pointId: string,
    result: { readonly depth: VerifyDepth; readonly error: string | null },
  ): Promise<void>;
  live(vaultId: string): Promise<readonly BackupPointRecord[]>;
  /** Ids with a catalog row, forgotten or not. */
  known(vaultId: string): Promise<ReadonlySet<string>>;
  /** Rows marked forgotten: their deletion may be unfinished after a crash. */
  forgotten(vaultId: string): Promise<ReadonlySet<string>>;
  /** Marks a point forgotten unless it is pinned; true when it is (now) forgotten. */
  forget(lease: AgentLease, vaultId: string, pointId: string): Promise<boolean>;
}

export interface VaultListing {
  readonly identity: VaultIdentity;
  /** Valid committed points of every source. */
  readonly committed: readonly BackupManifest[];
  /** Point directories without COMMITTED: an interrupted forget, or damage. */
  readonly uncommitted: readonly string[];
  /** Directories with COMMITTED whose manifest does not validate. */
  readonly damaged: readonly string[];
}
export interface MaintainedVault extends ReadableVault {
  listing(): Promise<VaultListing>;
  /** Content bytes of `point` that `previous` lists too (sorted merge of both inventories). */
  sharedBytes(
    point: BackupManifest,
    previous: BackupManifest,
    cancellation: Cancellation,
  ): Promise<bigint>;
  /** COMMITTED first (the point disappears), then the directory; repeatable. */
  forget(pointId: string): Promise<void>;
  /**
   * Deletes content no point of `remaining` lists and leftovers of attempts. The caller holds
   * the exclusive vault lock and passes every committed point; inventories are checked first.
   */
  prune(
    remaining: readonly BackupManifest[],
    cancellation: Cancellation,
  ): Promise<{ readonly blobs: number; readonly bytes: bigint }>;
}

/**
 * Per-vault maintenance lock. Capture and verification share it; retention takes it alone, so
 * prune never deletes content that a running capture has just decided to reuse.
 */
export interface VaultLock {
  /** Refuses with `busy` instead of waiting; the cancellation fails once the lock is lost. */
  shared<T>(action: (held: Cancellation) => Promise<T>): Promise<T>;
  exclusive<T>(action: (held: Cancellation) => Promise<T>): Promise<T>;
}

export interface CaptureRunner {
  /**
   * One capture in its own source session (B1 locks plus the shared vault lock). `started`
   * receives the capture job id as soon as an attempt reports it.
   */
  run(
    idempotencyKey: string,
    started: (jobId: string) => void,
    cancellation: Cancellation,
  ): Promise<CaptureResult>;
}

export type AgentEvent =
  | { readonly code: 'request.started'; readonly id: string; readonly kind: BackupRequestKind }
  | {
      readonly code: 'request.done';
      readonly id: string;
      readonly kind: BackupRequestKind;
      readonly pointId: string | null;
    }
  | {
      readonly code: 'request.failed' | 'request.requeued';
      readonly id: string;
      readonly kind: BackupRequestKind;
      readonly errorCode: BackupFailureCode;
      /** The original error, for identifiers of its cause in the log; never shown to callers. */
      readonly cause?: unknown;
    }
  | { readonly code: 'schedule.due'; readonly slot: number; readonly id: string }
  | {
      readonly code: 'retention.applied';
      readonly forgotten: number;
      readonly blobs: number;
      readonly bytes: string;
    }
  | { readonly code: 'catalog.reconciled'; readonly points: number; readonly damaged: number };
