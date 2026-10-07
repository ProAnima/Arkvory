import type { WebhookState } from '@proanima/arkvory-application';
import type { MetricsRegistry } from '@proanima/arkvory-infrastructure';

const ttlMs = 5000;
const seconds = (iso: string | null) => (iso === null ? null : Math.floor(Date.parse(iso) / 1000));

/**
 * Webhook delivery gauges of the API process (ADR 0069), read from the database with a 5 s
 * single-flight cache. Labels are the subscription id and its repository: at most 16 operator
 * chosen values. A failed read omits the gauges instead of reporting stale values; an
 * installation without webhooks has no rows and so no samples.
 */
export class WebhookMetrics {
  private states: readonly WebhookState[] | undefined;
  private readAt = Number.NEGATIVE_INFINITY;
  private refreshing: Promise<void> | undefined;

  constructor(
    private readonly source: { all(): Promise<readonly WebhookState[]> },
    private readonly now: () => number,
  ) {}

  refresh(failed: () => void): Promise<void> {
    if (this.now() - this.readAt < ttlMs) return Promise.resolve();
    this.refreshing ??= this.source
      .all()
      .then(
        (states) => {
          this.states = states;
        },
        () => {
          this.states = undefined;
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
    const gauge = (name: string, help: string, value: (state: WebhookState) => number | null) => {
      registry.sampled({
        name,
        help,
        type: 'gauge',
        labels: ['subscription', 'repository'],
        collect: () =>
          (this.states ?? []).flatMap((state) => {
            const measured = value(state);
            return measured === null
              ? []
              : [
                  {
                    labels: { subscription: state.subscription, repository: state.repository },
                    value: measured,
                  },
                ];
          }),
      });
    };
    gauge(
      'arkvory_webhook_last_success_timestamp_seconds',
      'Last time the receiver answered 2xx to an event of the subscription (Unix seconds).',
      (state) => seconds(state.deliveredAt),
    );
    gauge(
      'arkvory_webhook_failing',
      'Webhook delivery: 1 while the last attempt failed, 0 otherwise.',
      (state) => (state.errorCode === null ? 0 : 1),
    );
  }
}
