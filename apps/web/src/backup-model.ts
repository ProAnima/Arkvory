import type {
  BackupJobResponse,
  BackupJobStateName,
  BackupPointResponse,
  BackupStatusResponse,
} from '@proanima/arkvory-contracts';

/*
 * Pure view rules of the Backups screen (ADR 0056). No DOM and no clock: time is a parameter,
 * so the rules are unit-tested with fixed instants.
 */

export type BackupState = 'ok' | 'warning' | 'critical';

/** Any critical warning makes the whole state critical; status is never green with warnings. */
export function overallState(warnings: BackupStatusResponse['warnings']): BackupState {
  if (warnings.some((warning) => warning.severity === 'critical')) return 'critical';
  return warnings.length ? 'warning' : 'ok';
}

/** States in which a job still changes: the screen polls only while one exists. */
export function jobActive(state: BackupJobStateName): boolean {
  return state === 'queued' || state === 'running' || state === 'committing';
}

export function needsPolling(
  status: Pick<BackupStatusResponse, 'running'> | null,
  jobs: readonly Pick<BackupJobResponse, 'state'>[],
): boolean {
  return status?.running != null || jobs.some((job) => jobActive(job.state));
}

/** A capture waits or runs: "Create a backup now" stays disabled, so one click is one job. */
export function captureBusy(
  status: Pick<BackupStatusResponse, 'running'> | null,
  jobs: readonly Pick<BackupJobResponse, 'kind' | 'state'>[],
): boolean {
  if (status?.running?.kind === 'capture') return true;
  return jobs.some((job) => job.kind === 'capture' && jobActive(job.state));
}

/** 5 s while healthy; after failures 10, 20, 40 and at most 60 s between attempts. */
export function pollDelay(failures: number): number {
  return Math.min(60_000, 5000 * 2 ** Math.max(0, Math.min(failures, 4)));
}

export type NextRun =
  | { readonly kind: 'disabled' }
  | { readonly kind: 'unknown' }
  | { readonly kind: 'scheduled' | 'overdue'; readonly at: string };

/** nextRunAt stays in the past while the slot is missed (agent offline): that is overdue. */
export function nextRun(
  status: Pick<BackupStatusResponse, 'plan' | 'nextRunAt'>,
  now: number,
): NextRun {
  if (!status.plan.enabled) return { kind: 'disabled' };
  if (status.nextRunAt === null) return { kind: 'unknown' };
  return {
    kind: Date.parse(status.nextRunAt) < now ? 'overdue' : 'scheduled',
    at: status.nextRunAt,
  };
}

export type VaultView =
  | { readonly kind: 'not_configured' | 'unknown' | 'unavailable' }
  | { readonly kind: 'available'; readonly free: string | null; readonly total: string | null };

/**
 * Vault facts come from the agent's heartbeat. A vault that was never configured is reported as
 * such; otherwise an offline agent means the current state is unknown, not "available".
 */
export function vaultView(status: Pick<BackupStatusResponse, 'vault' | 'agent'>): VaultView {
  if (!status.vault.configured) return { kind: 'not_configured' };
  if (!status.agent.online) return { kind: 'unknown' };
  if (!status.vault.available) return { kind: 'unavailable' };
  return { kind: 'available', free: status.vault.freeBytes, total: status.vault.totalBytes };
}

export type VaultEncryption = 'encrypted' | 'plain' | 'unknown';

/** Encryption is the last flag the agent reported (ADR 0070); null means nothing is known. */
export function vaultEncryption(status: Pick<BackupStatusResponse, 'vault'>): VaultEncryption {
  if (!status.vault.configured || status.vault.encrypted === null) return 'unknown';
  return status.vault.encrypted ? 'encrypted' : 'plain';
}

export type Verification = 'none' | 'structural' | 'deep' | 'failed';

/** A recorded verification error wins over the depth of the last successful check. */
export function verification(
  point: Pick<BackupPointResponse, 'verifyDepth' | 'verifyError'>,
): Verification {
  if (point.verifyError !== null) return 'failed';
  return point.verifyDepth ?? 'none';
}

/**
 * Percent of processed bytes with one decimal, or null without a measurable total: the copy
 * phase knows its total, preparation does not, and no percentage is invented for it.
 * Byte counts are exact decimal strings up to 2^63, so the ratio is computed in BigInt.
 */
export function progressPercent(progress: BackupJobResponse['progress']): number | null {
  const total = BigInt(progress.bytesTotal);
  if (total <= 0n) return null;
  const done = BigInt(progress.bytesCopied);
  const permille = (done > total ? total : done) * 1000n;
  return Number(permille / total) / 10;
}

/** Current offset of an IANA zone as UTC±HH:MM, or null when this browser does not know it. */
export function zoneOffset(zone: string, at: number): string | null {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    }).formatToParts(at);
  } catch {
    return null;
  }
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((entry) => entry.type === type)?.value);
  const wall = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  );
  const minutes = Math.round((wall - Math.floor(at / 1000) * 1000) / 60_000);
  if (!Number.isFinite(minutes)) return null;
  const size = Math.abs(minutes);
  const hours = String(Math.floor(size / 60)).padStart(2, '0');
  return `UTC${minutes < 0 ? '-' : '+'}${hours}:${String(size % 60).padStart(2, '0')}`;
}

/** The zone the browser runs in; offered to the person, never applied to a saved plan. */
export function browserZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** IANA zones this browser knows, UTC first. The server still validates the chosen name. */
export function timeZones(): readonly string[] {
  return ['UTC', ...Intl.supportedValuesOf('timeZone').filter((zone) => zone !== 'UTC')];
}

/** "HH:MM" of a time input; null for anything else. */
export function parseTime(value: string): { hour: number; minute: number } | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) return null;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

export function formatTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}
