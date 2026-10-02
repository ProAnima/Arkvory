import type {
  BackupJobKind,
  BackupJobStateName,
  BackupRetentionReasonName,
  BackupWarningName,
} from '@proanima/arkvory-contracts';
import type { BackupState, Verification } from './backup-model.js';
import type { MessageKey } from './messages.js';

/* Closed wire values (ADR 0056) → dictionary keys. A new wire value fails type checking here. */

export const stateKeys: Readonly<Record<BackupState, MessageKey>> = {
  ok: 'backupStateOk',
  warning: 'backupStateWarning',
  critical: 'backupStateCritical',
};

/** One-line message and the operator action shown in its tooltip. */
export const warningKeys: Readonly<
  Record<BackupWarningName, { readonly text: MessageKey; readonly action: MessageKey }>
> = {
  vault_not_configured: {
    text: 'backupWarningVaultNotConfigured',
    action: 'backupActionVaultNotConfigured',
  },
  agent_offline: { text: 'backupWarningAgentOffline', action: 'backupActionAgentOffline' },
  schedule_disabled: {
    text: 'backupWarningScheduleDisabled',
    action: 'backupActionScheduleDisabled',
  },
  no_backup_yet: { text: 'backupWarningNoBackupYet', action: 'backupActionNoBackupYet' },
  backup_stale: { text: 'backupWarningBackupStale', action: 'backupActionBackupStale' },
  last_run_failed: { text: 'backupWarningLastRunFailed', action: 'backupActionLastRunFailed' },
  vault_unavailable: {
    text: 'backupWarningVaultUnavailable',
    action: 'backupActionVaultUnavailable',
  },
  vault_low_space: { text: 'backupWarningVaultLowSpace', action: 'backupActionVaultLowSpace' },
  verify_failed: { text: 'backupWarningVerifyFailed', action: 'backupActionVerifyFailed' },
  never_deep_verified: {
    text: 'backupWarningNeverDeepVerified',
    action: 'backupActionNeverDeepVerified',
  },
};

export const kindKeys: Readonly<Record<BackupJobKind, MessageKey>> = {
  capture: 'backupKindCapture',
  verify: 'backupKindVerify',
  retention: 'backupKindRetention',
};

export const jobStateKeys: Readonly<Record<BackupJobStateName, MessageKey>> = {
  queued: 'backupJobQueued',
  running: 'backupJobRunning',
  committing: 'backupJobCommitting',
  completed: 'backupJobCompleted',
  failed: 'backupJobFailed',
  interrupted: 'backupJobInterrupted',
};

// Phases are open machine codes on the wire; the known ones read as the stages of BACKUP_UX.
const phases: Readonly<Record<string, MessageKey>> = {
  barrier: 'backupPhasePreparing',
  pins: 'backupPhasePreparing',
  tables: 'backupPhaseCatalog',
  blobs: 'backupPhaseTransfer',
  manifest: 'backupPhaseFinishing',
  commit: 'backupPhaseFinishing',
  done: 'backupPhaseDone',
  structural: 'backupPhaseStructural',
  deep: 'backupPhaseDeep',
};
/** Localized stage, or undefined: an unknown future phase is shown as its code. */
export function phaseKey(phase: string): MessageKey | undefined {
  return Object.hasOwn(phases, phase) ? phases[phase] : undefined;
}

export const verificationKeys: Readonly<Record<Verification, MessageKey>> = {
  none: 'backupVerifyNone',
  structural: 'backupVerifyStructural',
  deep: 'backupVerifyDeep',
  failed: 'backupVerifyFailed',
};

export const reasonKeys: Readonly<Record<BackupRetentionReasonName, MessageKey>> = {
  daily: 'backupReasonDaily',
  weekly: 'backupReasonWeekly',
  monthly: 'backupReasonMonthly',
  pinned: 'backupReasonPinned',
  newest: 'backupReasonNewest',
};
