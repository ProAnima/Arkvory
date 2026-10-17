import type { EventLogSnapshot, MetricsRegistry } from '@proanima/arkvory-infrastructure';

const ttlMs = 5000;

/**
 * Gauges of the event outbox (ADR 0080, section 7), read from the database with a 5 s
 * single-flight cache like the webhook gauges. The pruned total is a counter kept in the
 * database, so it survives restarts and only restarts with a new epoch. A failed read omits
 * the samples instead of reporting stale values.
 */
export class EventMetrics {
  private snapshot: EventLogSnapshot | undefined;
  private readAt = Number.NEGATIVE_INFINITY;
  private refreshing: Promise<void> | undefined;

  constructor(
    private readonly source: { snapshot(): Promise<EventLogSnapshot> },
    private readonly now: () => number,
  ) {}

  refresh(failed: () => void): Promise<void> {
    if (this.now() - this.readAt < ttlMs) return Promise.resolve();
    this.refreshing ??= this.source
      .snapshot()
      .then(
        (snapshot) => {
          this.snapshot = snapshot;
        },
        () => {
          this.snapshot = undefined;
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
    const sample = (
      name: string,
      help: string,
      type: 'gauge' | 'counter',
      value: (snapshot: EventLogSnapshot) => number,
    ) => {
      registry.sampled({
        name,
        help,
        type,
        labels: [],
        collect: () => (this.snapshot ? [{ labels: {}, value: value(this.snapshot) }] : []),
      });
    };
    sample(
      'arkvory_events_head_position',
      'Newest position of the event feed in its epoch.',
      'gauge',
      (s) => Number(s.head),
    );
    sample(
      'arkvory_events_oldest_position',
      'Lowest cursor the event feed still accepts; older cursors answer 410.',
      'gauge',
      (s) => Number(s.oldest),
    );
    sample(
      'arkvory_events_unsequenced_age_seconds',
      'Age of the oldest committed event still waiting for the sequencer; 0 when none waits.',
      'gauge',
      (s) => s.unsequencedAgeSeconds,
    );
    sample(
      'arkvory_events_pruned_total',
      'Events removed by retention in this epoch.',
      'counter',
      (s) => Number(s.prunedTotal),
    );
  }
}
