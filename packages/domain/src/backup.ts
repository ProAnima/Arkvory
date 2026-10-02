/**
 * Capture job lifecycle of the built-in backup vault (ADR 0054). One job belongs to one
 * idempotency key; every attempt of it runs under a new fencing generation and can produce at
 * most the single restore point named by the job.
 */
export const backupJobStates = [
  'running',
  'committing',
  'completed',
  'failed',
  'interrupted',
] as const;
export type BackupJobState = (typeof backupJobStates)[number];

/** Ordered capture phases; the stored phase names where a failed attempt stopped. */
export const backupPhases = [
  'barrier',
  'pins',
  'tables',
  'blobs',
  'manifest',
  'commit',
  'done',
] as const;
export type BackupPhase = (typeof backupPhases)[number];

/** Closed machine codes of a failed or refused backup operation. */
export const backupFailureCodes = [
  'attempts_exhausted',
  'barrier_timeout',
  'blob_missing',
  'busy',
  'capture_timeout',
  'capture_too_large',
  'integrity_mismatch',
  'interrupted',
  'invalid_argument',
  'invalid_manifest',
  'lease_lost',
  'point_not_found',
  'schema_mismatch',
  'snapshot_lost',
  'storage_full',
  'storage_mismatch',
  'target_not_empty',
  'unavailable',
  'unexpected',
  'unknown_table',
  'unsafe_path',
  'upgrade_required',
  'vault_full',
  'vault_missing',
] as const;
export type BackupFailureCode = (typeof backupFailureCodes)[number];

export class BackupFailure extends Error {
  readonly code: BackupFailureCode;
  constructor(code: BackupFailureCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'BackupFailure';
    this.code = code;
  }
}

export function isBackupFailureCode(value: string): value is BackupFailureCode {
  const known: readonly string[] = backupFailureCodes;
  return known.includes(value);
}

/**
 * Every allowed state change. A failed or interrupted job may start a new attempt under a new
 * generation (bounded by its attempts); a completed job never changes again.
 */
export function backupTransitionAllowed(from: BackupJobState, to: BackupJobState): boolean {
  switch (from) {
    case 'running':
      return to === 'committing' || to === 'failed' || to === 'interrupted';
    case 'committing':
      // A commit with an unknown outcome is reconciled from the vault, never declared failed.
      return to === 'completed' || to === 'interrupted';
    case 'failed':
    case 'interrupted':
      return to === 'running';
    case 'completed':
      return false;
  }
}

/** A running or committing job has an owner whose lease must expire before it is fenced. */
export function hasLiveAttempt(state: BackupJobState): boolean {
  switch (state) {
    case 'running':
    case 'committing':
      return true;
    case 'completed':
    case 'failed':
    case 'interrupted':
      return false;
  }
}

/** Phases only move forward within one attempt. */
export function backupPhaseAdvances(from: BackupPhase, to: BackupPhase): boolean {
  return backupPhases.indexOf(to) > backupPhases.indexOf(from);
}

export interface StoredCaptureJob {
  readonly state: BackupJobState;
  readonly attempts: number;
  /** The database clock passed lease_until; the previous owner may be fenced. */
  readonly leaseExpired: boolean;
}

/**
 * What a capture request that finds an existing job must do. `fence` interrupts the stale owner
 * (new generation, pins released, barrier reopened); the caller then decides again from the
 * resulting `interrupted` state, so exhausted jobs still give their pins back.
 */
export type CaptureReuse =
  | { readonly action: 'return_completed' }
  | { readonly action: 'busy' }
  | { readonly action: 'fence' }
  | { readonly action: 'retry' }
  | { readonly action: 'exhausted' };

export function captureReuse(job: StoredCaptureJob, maxAttempts: number): CaptureReuse {
  switch (job.state) {
    case 'completed':
      return { action: 'return_completed' };
    case 'running':
    case 'committing':
      // A live lease means another process owns the attempt; expiry alone never releases pins.
      return job.leaseExpired ? { action: 'fence' } : { action: 'busy' };
    case 'failed':
    case 'interrupted':
      return job.attempts >= maxAttempts ? { action: 'exhausted' } : { action: 'retry' };
  }
}

export type SchemaCompatibility = 'compatible' | 'too_old' | 'too_new';

/**
 * Restore loads data only into the schema it was exported from and migrates forward from there.
 * A backup newer than this release cannot be interpreted; one older than the oldest supported
 * normalization has no verified transformer.
 */
export function restoreSchemaGate(
  backupSchema: number,
  releaseSchema: number,
  minimumSchema: number,
): SchemaCompatibility {
  if (![backupSchema, releaseSchema, minimumSchema].every((value) => Number.isSafeInteger(value)))
    return 'too_new';
  if (backupSchema > releaseSchema) return 'too_new';
  if (backupSchema < minimumSchema) return 'too_old';
  return 'compatible';
}
