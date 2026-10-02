import { backupWarningCodes } from '@proanima/arkvory-domain';
import { evaluateBackupStatus } from '@proanima/arkvory-application';
import type { BackupStatusSource, BackupStatusView } from '@proanima/arkvory-application';
import type { MetricsRegistry } from '@proanima/arkvory-infrastructure';

const ttlMs = 5000;

/**
 * Backup gauges of the API process (ADR 0056), read from the database with the same 5 s
 * single-flight cache as the completion backlog. A failed read omits the gauges instead of
 * reporting stale values. Labels are bounded: the closed warning code set only.
 */
export class BackupMetrics {
  private view: BackupStatusView | undefined;
  private readAt = Number.NEGATIVE_INFINITY;
  private refreshing: Promise<void> | undefined;

  constructor(
    private readonly source: BackupStatusSource,
    private readonly now: () => number,
  ) {}

  refresh(failed: () => void): Promise<void> {
    if (this.now() - this.readAt < ttlMs) return Promise.resolve();
    this.refreshing ??= this.source
      .snapshot()
      .then(
        (snapshot) => {
          this.view = evaluateBackupStatus(snapshot);
        },
        () => {
          this.view = undefined;
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
    registry.sampled({
      name: 'arkvory_backup_last_success_timestamp_seconds',
      help: 'Snapshot time T of the newest completed backup point (Unix seconds); age counts from T.',
      type: 'gauge',
      labels: [],
      collect: () => {
        const point = this.view?.lastCompleted;
        return point ? [{ labels: {}, value: Math.floor(point.snapshotAt / 1000) }] : [];
      },
    });
    registry.sampled({
      name: 'arkvory_backup_agent_last_seen_timestamp_seconds',
      help: 'Last heartbeat of the backup agent (Unix seconds).',
      type: 'gauge',
      labels: [],
      collect: () => {
        const seen = this.view?.agent.lastSeenAt;
        return seen === undefined || seen === null
          ? []
          : [{ labels: {}, value: Math.floor(seen / 1000) }];
      },
    });
    registry.sampled({
      name: 'arkvory_backup_warnings',
      help: 'Backup warnings by code: 1 while active, 0 otherwise.',
      type: 'gauge',
      labels: ['code'],
      collect: () => {
        const view = this.view;
        if (!view) return [];
        const active = new Set(view.warnings.map((warning) => warning.code));
        return backupWarningCodes.map((code) => ({
          labels: { code },
          value: active.has(code) ? 1 : 0,
        }));
      },
    });
  }
}
