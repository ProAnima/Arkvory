import { MirrorFailure } from './mirror-ports.js';

/*
 * Entries of a source put aside (ADR 0058, 2026-10-15). A conflict concerns one version of the
 * source, not the feed: a package version this repository holds with other bytes, or an artifact
 * ID another repository here holds. Stopping the feed on it blocked every later change of the
 * source for good; skipping it silently (before 0.4) hid it. So the entry is recorded and the
 * feed goes on; the record is retried, shown in the status, counted in a metric and alerted on.
 * Any other failure (network, checksum, a blocked deletion) still stops the step and repeats it.
 */

/** The stops that concern one entry and are put aside; every other code stops the feed. */
export const mirrorConflictCodes = ['mirror_package_conflict', 'mirror_id_taken'] as const;
export type MirrorConflictCode = (typeof mirrorConflictCodes)[number];

/**
 * What to apply again: a feed entry without its sequence. Seed units are named like the entry
 * that brings the same change (`artifact.publish`, `package.register`, `asset.replace` with the
 * path; `stage.add` with no stage for the seed of an import).
 */
export interface MirrorConflictEntry {
  readonly artifactId: string;
  readonly action: string;
  readonly detail: string | null;
}
export interface MirrorConflict extends MirrorConflictEntry {
  readonly code: MirrorConflictCode;
  /** When it was put aside first, and when it was last tried (ISO 8601 UTC). */
  readonly firstAt: string;
  readonly lastAt: string;
  readonly attempts: number;
}
export interface MirrorConflictSummary {
  readonly count: number;
  /** When the oldest entry still set aside was put aside first; null when there is none. */
  readonly oldestAt: string | null;
  /** The oldest entries, at most the limit asked for. */
  readonly sample: readonly MirrorConflict[];
}

/** The synchronization's side: one writer per repository, the worker that owns the storage. */
export interface MirrorConflictStore {
  /**
   * Records the entry as set aside, or one more failed attempt of an entry set aside before
   * (its code is the latest one). Returns the attempts so far.
   */
  setAside(
    repository: string,
    entry: MirrorConflictEntry,
    code: MirrorConflictCode,
    at: string,
  ): Promise<number>;
  /** Entries last tried at or before `before`, the least recently tried first. */
  due(repository: string, before: string, limit: number): Promise<readonly MirrorConflict[]>;
  /** Absence is success: the entry was applied, or the source no longer has it. */
  resolve(repository: string, entry: MirrorConflictEntry): Promise<void>;
}
/** The status side. */
export interface MirrorConflictReader {
  summary(repository: string, limit: number): Promise<MirrorConflictSummary>;
}

/** An entry is tried again ten minutes after its last attempt, as many per step as this. */
export const CONFLICT_RETRY_MS = 600_000;
export const CONFLICT_RETRY_LIMIT = 8;

export function conflictCode(error: unknown): MirrorConflictCode | null {
  if (!(error instanceof MirrorFailure)) return null;
  return mirrorConflictCodes.find((code) => code === error.code) ?? null;
}

interface ConflictDependencies {
  readonly repository: string;
  readonly conflicts: MirrorConflictStore;
  readonly now: () => string;
}

/**
 * Runs one unit of the synchronization; a conflict of that unit is recorded instead of stopping
 * the step, so the caller saves its position and goes on. Other failures propagate unchanged.
 */
export async function setAside(
  d: ConflictDependencies,
  entry: MirrorConflictEntry,
  work: () => Promise<unknown>,
): Promise<void> {
  try {
    await work();
  } catch (error) {
    const code = conflictCode(error);
    if (code === null) throw error;
    await d.conflicts.setAside(d.repository, entry, code, d.now());
  }
}

/**
 * Tries entries set aside again, a bounded number per step: one that applies, or that the source
 * no longer offers (`apply` then finds nothing to do), is removed; a conflict again counts one more
 * attempt. Any other failure stops the step as usual and the entry stays for the next one.
 */
export async function retryConflicts(
  d: ConflictDependencies,
  apply: (entry: MirrorConflictEntry) => Promise<unknown>,
): Promise<void> {
  const before = new Date(Date.parse(d.now()) - CONFLICT_RETRY_MS).toISOString();
  const due = await d.conflicts.due(d.repository, before, CONFLICT_RETRY_LIMIT);
  for (const conflict of due) {
    const entry = {
      artifactId: conflict.artifactId,
      action: conflict.action,
      detail: conflict.detail,
    };
    await setAside(d, entry, async () => {
      await apply(entry);
      await d.conflicts.resolve(d.repository, entry);
    });
  }
}
