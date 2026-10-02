/**
 * Backup warnings (ADR 0056): a pure function of status facts. Codes and severities are closed
 * machine values; warnings never carry paths, URLs or secrets.
 */
export const backupWarningCodes = [
  'vault_not_configured',
  'agent_offline',
  'schedule_disabled',
  'no_backup_yet',
  'backup_stale',
  'last_run_failed',
  'vault_unavailable',
  'vault_low_space',
  'verify_failed',
  'never_deep_verified',
] as const;
export type BackupWarningCode = (typeof backupWarningCodes)[number];
export type BackupWarningSeverity = 'warning' | 'critical';
export interface BackupWarning {
  readonly code: BackupWarningCode;
  readonly severity: BackupWarningSeverity;
}

export const backupWarningSeverity: Readonly<Record<BackupWarningCode, BackupWarningSeverity>> = {
  vault_not_configured: 'warning',
  agent_offline: 'critical',
  schedule_disabled: 'warning',
  no_backup_yet: 'warning',
  backup_stale: 'critical',
  last_run_failed: 'warning',
  vault_unavailable: 'critical',
  vault_low_space: 'warning',
  verify_failed: 'critical',
  never_deep_verified: 'warning',
};

export const backupThresholds = {
  agentOfflineMs: 2 * 60_000,
  staleMs: 26 * 3_600_000,
  deepVerifyMs: 8 * 86_400_000,
  lowSpacePercent: 10n,
} as const;

export interface BackupStatusFacts {
  readonly now: number;
  /** Last heartbeat of the agent; null when no agent ever reported. */
  readonly agentSeenAt: number | null;
  /** Vault facts of the last heartbeat. */
  readonly vault: {
    readonly configured: boolean;
    readonly available: boolean;
    readonly freeBytes: bigint | null;
    readonly totalBytes: bigint | null;
  };
  readonly scheduleEnabled: boolean;
  /** Newest completed point of this source in the current vault. */
  readonly newest: { readonly snapshotAt: number; readonly newBytes: bigint } | null;
  /** The most recent finished capture failed. */
  readonly lastCaptureFailed: boolean;
  /** A live point failed its latest verification. */
  readonly verifyFailed: boolean;
  /** Latest successful deep verification of any live point. */
  readonly lastDeepVerifiedAt: number | null;
}

export function agentOnline(facts: Pick<BackupStatusFacts, 'now' | 'agentSeenAt'>): boolean {
  return (
    facts.agentSeenAt !== null && facts.now - facts.agentSeenAt <= backupThresholds.agentOfflineMs
  );
}

function lowSpace(facts: BackupStatusFacts): boolean {
  const { freeBytes, totalBytes } = facts.vault;
  if (freeBytes === null || totalBytes === null || totalBytes <= 0n) return false;
  if (freeBytes * 100n < totalBytes * backupThresholds.lowSpacePercent) return true;
  return facts.newest !== null && freeBytes < facts.newest.newBytes * 2n;
}

/**
 * Vault facts come from the agent: while it is offline they are unknown, so only the offline
 * warning speaks for them. Age is measured from snapshot T of the newest completed point.
 */
export function backupWarnings(facts: BackupStatusFacts): readonly BackupWarning[] {
  const online = agentOnline(facts);
  const { configured, available } = facts.vault;
  const active: Record<BackupWarningCode, boolean> = {
    vault_not_configured: !configured,
    agent_offline: !online,
    schedule_disabled: !facts.scheduleEnabled,
    no_backup_yet: facts.newest === null,
    backup_stale:
      facts.scheduleEnabled &&
      facts.newest !== null &&
      facts.now - facts.newest.snapshotAt > backupThresholds.staleMs,
    last_run_failed: facts.lastCaptureFailed,
    vault_unavailable: online && configured && !available,
    vault_low_space: online && configured && available && lowSpace(facts),
    verify_failed: facts.verifyFailed,
    never_deep_verified:
      facts.newest !== null &&
      (facts.lastDeepVerifiedAt === null ||
        facts.now - facts.lastDeepVerifiedAt > backupThresholds.deepVerifyMs),
  };
  return backupWarningCodes
    .filter((code) => active[code])
    .map((code) => ({ code, severity: backupWarningSeverity[code] }));
}
