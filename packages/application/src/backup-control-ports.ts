import type {
  BackupJobViewState,
  BackupPlanSettings,
  BackupPlanUpdate,
  BackupRequestKind,
  VerifyDepth,
} from '@proanima/arkvory-domain';

/*
 * Ports of the backup control plane (ADR 0056): the API reads state that the agent writes and
 * queues typed requests. Times are milliseconds since the epoch; byte counts are decimal strings.
 * No port accepts or returns a filesystem path.
 */

export interface StoredBackupPlan extends BackupPlanSettings {
  readonly revision: number;
  /** When enabled/hour/minute/timezone last changed: earlier slots are never caught up. */
  readonly scheduleFrom: number;
  /** Latest slot the agent turned into a capture request. */
  readonly lastSlotAt: number | null;
  readonly updatedAt: number;
  readonly updatedBy: string | null;
}

export interface BackupPointRecord {
  readonly id: string;
  readonly vaultId: string;
  /** Snapshot time T. */
  readonly snapshotAt: number;
  readonly completedAt: number;
  readonly blobs: number;
  readonly contentBytes: string;
  /** Bytes this point added to the vault (copied by its capture, or estimated on rebuild). */
  readonly newBytes: string;
  readonly tables: number;
  readonly rows: number;
  readonly pinned: boolean;
  /** Latest verification of any depth and its machine result. */
  readonly verifiedAt: number | null;
  readonly verifyDepth: VerifyDepth | null;
  readonly verifyError: string | null;
  /** Latest successful deep verification. */
  readonly deepVerifiedAt: number | null;
}

export interface BackupJobProgress {
  readonly bytesCopied: string;
  readonly bytesTotal: string;
  readonly blobsCopied: number;
  readonly blobsTotal: number;
}
export interface BackupJobRecord {
  readonly id: string;
  readonly kind: BackupRequestKind;
  readonly state: BackupJobViewState;
  readonly phase: string | null;
  /** Start of execution, or the request time while queued. */
  readonly startedAt: number;
  readonly finishedAt: number | null;
  readonly errorCode: string | null;
  readonly pointId: string | null;
  readonly progress: BackupJobProgress;
}

export interface BackupAgentRecord {
  /** False after the agent released its lease (stopped); seenAt stays its last heartbeat. */
  readonly active: boolean;
  readonly seenAt: number;
  readonly version: string | null;
  readonly vaultConfigured: boolean;
  readonly vaultId: string | null;
  readonly vaultAvailable: boolean;
  readonly freeBytes: string | null;
  readonly totalBytes: string | null;
  readonly lastError: string | null;
  /** Null: unknown (old agent, unreadable vault.json). */
  readonly vaultEncrypted: boolean | null;
}

/** One consistent read of everything the status and the metrics derive from. */
export interface BackupStatusSnapshot {
  /** Database clock of the read; heartbeats are stamped with the same clock. */
  readonly now: number;
  readonly agent: BackupAgentRecord | null;
  readonly plan: StoredBackupPlan;
  /** Newest completed point of the current vault. */
  readonly newest: BackupPointRecord | null;
  readonly running: BackupJobRecord | null;
  readonly lastCaptureFailed: boolean;
  readonly verifyFailed: boolean;
  readonly lastDeepVerifiedAt: number | null;
}
export interface BackupStatusSource {
  snapshot(): Promise<BackupStatusSnapshot>;
  /** Vault of the last heartbeat; points and previews belong to it. */
  currentVault(): Promise<string | null>;
}

export interface BackupPlanStore {
  read(): Promise<StoredBackupPlan>;
  /** Compare-and-swap on revision: conflict/revision_mismatch when it moved. */
  save(update: BackupPlanUpdate, actor: string): Promise<StoredBackupPlan>;
}

export interface BackupRequestInput {
  readonly id: string;
  readonly kind: BackupRequestKind;
  readonly pointId: string | null;
  readonly depth: VerifyDepth | null;
  readonly idempotencyKey: string;
  readonly requestedBy: string;
  readonly requestId: string | null;
}
export interface BackupRequestReceipt {
  readonly id: string;
  readonly kind: BackupRequestKind;
  readonly state: BackupJobViewState;
}
export interface BackupRequestQueue {
  /**
   * Idempotent per requester, kind and key: a repeat returns the existing request in its
   * current state; the same key for another point is conflict/idempotency_mismatch.
   */
  enqueue(request: BackupRequestInput): Promise<BackupRequestReceipt>;
}

export interface BackupPage<T> {
  readonly items: readonly T[];
  readonly next: string | null;
}
export interface BackupPageQuery {
  /** Opaque cursor from a previous page. */
  readonly after?: string;
  readonly limit: number;
}
export interface BackupJobLog {
  /** Newest first: agent requests and captures started outside the agent. */
  jobs(query: BackupPageQuery): Promise<BackupPage<BackupJobRecord>>;
}
export interface BackupPointCatalog {
  /** Live (not forgotten) points of one vault, newest snapshot first. */
  points(vaultId: string, query: BackupPageQuery): Promise<BackupPage<BackupPointRecord>>;
  /** Null when the point is unknown or forgotten. */
  pin(vaultId: string, pointId: string, pinned: boolean): Promise<BackupPointRecord | null>;
  point(vaultId: string, pointId: string): Promise<BackupPointRecord | null>;
  /** Every live point of one vault, bounded by the vault listing limit. */
  live(vaultId: string): Promise<readonly BackupPointRecord[]>;
}
