import { ZoneClock, calendarBuckets } from './backup-schedule.js';
import type { CalendarBuckets } from './backup-schedule.js';

/** Restore point retention (ADR 0056): newest N per local day, ISO week and month, united. */
export interface BackupRetentionPolicy {
  readonly daily: number;
  readonly weekly: number;
  readonly monthly: number;
}
export const defaultBackupRetention: BackupRetentionPolicy = { daily: 7, weekly: 4, monthly: 6 };
export const backupRetentionLimits: BackupRetentionPolicy = {
  daily: 366,
  weekly: 260,
  monthly: 120,
};

export const retentionReasons = ['daily', 'weekly', 'monthly', 'pinned', 'newest'] as const;
export type RetentionReason = (typeof retentionReasons)[number];

export interface RetentionCandidate {
  readonly id: string;
  /** Snapshot time T, milliseconds: age and buckets are measured from T, not from the copy. */
  readonly snapshotAt: number;
  readonly pinned: boolean;
}
export interface RetentionPlan {
  /** Newest first; every kept point names why it stays. */
  readonly keep: readonly { readonly id: string; readonly reasons: readonly RetentionReason[] }[];
  readonly delete: readonly { readonly id: string }[];
}

const groups = [
  ['daily', 'day'],
  ['weekly', 'week'],
  ['monthly', 'month'],
] as const satisfies readonly (readonly [keyof BackupRetentionPolicy, keyof CalendarBuckets])[];

function newestFirst(a: RetentionCandidate, b: RetentionCandidate): number {
  if (a.snapshotAt !== b.snapshotAt) return b.snapshotAt - a.snapshotAt;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/**
 * Each group keeps the newest point of each of its newest N distinct buckets in the plan time
 * zone; the groups are united, so 7/4/6 keeps at most 17 points and usually fewer. Pinned points
 * and the newest point are always kept, so at least one completed point survives whenever one
 * exists. Callers pass only healthy points of this source: a point that failed verification is
 * neither deleted nor allowed to displace a healthy one.
 */
export function planRetention(
  points: readonly RetentionCandidate[],
  policy: BackupRetentionPolicy,
  timezone: string,
): RetentionPlan {
  const clock = new ZoneClock(timezone);
  const ordered = [...points].sort(newestFirst);
  const reasons = new Map<string, Set<RetentionReason>>(
    ordered.map((point) => [point.id, new Set()]),
  );
  const newest = ordered[0];
  if (newest) reasons.get(newest.id)?.add('newest');
  for (const point of ordered) if (point.pinned) reasons.get(point.id)?.add('pinned');
  const buckets = new Map(
    ordered.map((point) => [point.id, calendarBuckets(clock, point.snapshotAt)]),
  );
  for (const [reason, bucket] of groups) {
    const seen = new Set<string>();
    for (const point of ordered) {
      if (seen.size >= policy[reason]) break;
      const key = buckets.get(point.id)?.[bucket];
      if (key === undefined || seen.has(key)) continue;
      seen.add(key);
      reasons.get(point.id)?.add(reason);
    }
  }
  const keep: { id: string; reasons: RetentionReason[] }[] = [];
  const remove: { id: string }[] = [];
  for (const point of ordered) {
    const kept = reasons.get(point.id) ?? new Set();
    if (kept.size)
      keep.push({ id: point.id, reasons: retentionReasons.filter((reason) => kept.has(reason)) });
    else remove.push({ id: point.id });
  }
  return { keep, delete: remove };
}
