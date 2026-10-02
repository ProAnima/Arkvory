import type { MirrorStatusEntry } from '@proanima/arkvory-application';
import type { MetricsRegistry } from '@proanima/arkvory-infrastructure';

const ttlMs = 5000;
const seconds = (iso: string | null) => (iso === null ? null : Math.floor(Date.parse(iso) / 1000));

/**
 * Mirror gauges of the API process (ADR 0058), read from the database with a 5 s single-flight
 * cache. Labels are the configured mirrored repositories only (at most 64). A failed read omits
 * the gauges instead of reporting stale values; a mirror the worker has not reached yet has no
 * sync time, so the stale alert does not fire before its first synchronization.
 */
export class MirrorMetrics {
  private entries: readonly MirrorStatusEntry[] | undefined;
  private readAt = Number.NEGATIVE_INFINITY;
  private refreshing: Promise<void> | undefined;

  constructor(
    private readonly source: { all(): Promise<readonly MirrorStatusEntry[]> },
    private readonly now: () => number,
  ) {}

  refresh(failed: () => void): Promise<void> {
    if (this.now() - this.readAt < ttlMs) return Promise.resolve();
    this.refreshing ??= this.source
      .all()
      .then(
        (entries) => {
          this.entries = entries;
        },
        () => {
          this.entries = undefined;
          failed();
        },
      )
      .finally(() => {
        this.readAt = this.now();
        this.refreshing = undefined;
      });
    return this.refreshing;
  }

  register(registry: MetricsRegistry): void {
    const gauge = (
      name: string,
      help: string,
      value: (entry: MirrorStatusEntry) => number | null,
    ) => {
      registry.sampled({
        name,
        help,
        type: 'gauge',
        labels: ['repository', 'mode'],
        collect: () =>
          (this.entries ?? []).flatMap((entry) => {
            const measured = value(entry);
            const mode = entry.stages ? 'import' : 'mirror';
            return measured === null
              ? []
              : [{ labels: { repository: entry.repository, mode }, value: measured }];
          }),
      });
    };
    gauge(
      'arkvory_mirror_last_sync_timestamp_seconds',
      'Last time the mirror was caught up with the source change feed (Unix seconds).',
      (entry) => seconds(entry.state?.syncedAt ?? null),
    );
    gauge(
      'arkvory_mirror_last_check_timestamp_seconds',
      'Last time the mirror read the source change feed (Unix seconds).',
      (entry) => seconds(entry.state?.checkedAt ?? null),
    );
    gauge(
      'arkvory_mirror_failing',
      'Mirror synchronization: 1 while the last attempt failed, 0 otherwise.',
      (entry) => (entry.state ? (entry.state.errorCode === null ? 0 : 1) : null),
    );
  }
}
