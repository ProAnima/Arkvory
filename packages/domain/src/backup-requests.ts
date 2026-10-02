import type { BackupFailureCode, BackupJobState } from './backup.js';

/**
 * Queued work of the backup agent (ADR 0056). A request is the job a caller sees; a capture
 * request is additionally executed by one capture job with its own lease and attempts (B1).
 */
export const backupRequestKinds = ['capture', 'verify', 'retention'] as const;
export type BackupRequestKind = (typeof backupRequestKinds)[number];
export const backupRequestStates = ['queued', 'running', 'done', 'failed'] as const;
export type BackupRequestState = (typeof backupRequestStates)[number];
export const verifyDepths = ['structural', 'deep'] as const;
export type VerifyDepth = (typeof verifyDepths)[number];
/** Claims of one request, including restarts after a crash or a shutdown. */
export const MAX_REQUEST_ATTEMPTS = 5;

/** States of the public job view: requests and captures started outside the agent (CLI). */
export const backupJobViewStates = [
  'queued',
  'running',
  'committing',
  'completed',
  'failed',
  'interrupted',
] as const;
export type BackupJobViewState = (typeof backupJobViewStates)[number];

export function jobViewState(
  request: BackupRequestState | null,
  capture: BackupJobState | null,
): BackupJobViewState {
  switch (request) {
    case 'queued':
      return 'queued';
    case 'running':
      return capture === 'committing' ? 'committing' : 'running';
    case 'done':
      return 'completed';
    case 'failed':
      return 'failed';
    case null:
      switch (capture) {
        case 'running':
        case 'committing':
        case 'completed':
        case 'failed':
        case 'interrupted':
          return capture;
        case null:
          return 'failed';
      }
  }
}

/**
 * Whether a request that stopped with `code` runs again. Shutdown, contention and transient
 * loss of the database or of a lease are retried within the attempt budget; everything else is
 * a final, recorded failure. A capture retry reuses the same capture job (B1 fencing applies).
 */
export function requestRetry(code: BackupFailureCode, attempts: number): 'requeue' | 'fail' {
  if (attempts >= MAX_REQUEST_ATTEMPTS) return 'fail';
  switch (code) {
    case 'interrupted':
    case 'busy':
    case 'barrier_timeout':
    case 'lease_lost':
    case 'snapshot_lost':
    case 'unavailable':
      return 'requeue';
    case 'attempts_exhausted':
    case 'blob_missing':
    case 'capture_timeout':
    case 'capture_too_large':
    case 'integrity_mismatch':
    case 'invalid_argument':
    case 'invalid_manifest':
    case 'point_not_found':
    case 'schema_mismatch':
    case 'storage_full':
    case 'storage_mismatch':
    case 'target_not_empty':
    case 'unexpected':
    case 'unknown_table':
    case 'unsafe_path':
    case 'upgrade_required':
    case 'vault_full':
    case 'vault_missing':
      return 'fail';
  }
}
