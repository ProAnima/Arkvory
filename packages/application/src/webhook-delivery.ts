import type { Cancellation } from './ports.js';
import { WebhookFailure } from './webhook-ports.js';
import type {
  WebhookEvent,
  WebhookFeed,
  WebhookSender,
  WebhookState,
  WebhookStateStore,
} from './webhook-ports.js';

export interface WebhookDeliveryDependencies {
  readonly subscription: string;
  readonly repository: string;
  /** Feed actions to deliver; absent means all. Other events are skipped, never delivered. */
  readonly actions?: readonly string[];
  readonly feed: WebhookFeed;
  readonly sender: WebhookSender;
  readonly states: WebhookStateStore;
  readonly now: () => string;
  /** Uniform in [0, 1); injected so that tests do not depend on chance. */
  readonly random: () => number;
}

/** `delivered`: the step moved the cursor and more may wait; `idle`: nothing to do; `failed`: backing off. */
export type WebhookStep = 'delivered' | 'idle' | 'failed';

const pageSize = 100;
const firstBackoffMs = 12_000;
const maxBackoffMs = 3_600_000;

/**
 * 12 s doubling to one hour, with ±20% jitter. The first wait keeps failed attempts to five per
 * minute at most, and a receiver that stays down is probed once an hour.
 */
export function webhookBackoffMs(failures: number, random: () => number): number {
  const base = Math.min(maxBackoffMs, firstBackoffMs * 2 ** Math.min(Math.max(failures, 1) - 1, 9));
  return Math.round(base * (0.8 + 0.4 * random()));
}

function failureCode(error: unknown): WebhookState['errorCode'] {
  return error instanceof WebhookFailure ? error.code : 'network';
}

/** Delivery of one subscription (ADR 0069), one step per call, driven by the worker loop. */
export class WebhookDelivery {
  constructor(private readonly d: WebhookDeliveryDependencies) {}

  async step(cancellation: Cancellation): Promise<WebhookStep> {
    const { repository, subscription } = this.d;
    const current = await this.d.states.load(subscription);
    if (current === null || current.repository !== repository) {
      // A new subscription reports what happens from now on, never the history that preceded it.
      const { head } = await this.d.feed.changes(repository, '0', 1);
      await this.d.states.save({
        subscription,
        repository,
        cursor: head,
        failures: 0,
        errorCode: null,
        errorAt: null,
        nextAttemptAt: null,
        deliveredAt: null,
        deliveredCount: 0,
      });
      return 'idle';
    }
    if (
      current.nextAttemptAt !== null &&
      Date.parse(this.d.now()) < Date.parse(current.nextAttemptAt)
    )
      return 'idle';
    const page = await this.d.feed.changes(repository, current.cursor, pageSize);
    let state = current;
    let delivered = 0;
    let unsaved = false;
    for (const entry of page.items) {
      cancellation.throwIfAborted();
      const wanted = this.d.actions === undefined || this.d.actions.includes(entry.action);
      if (!wanted) {
        state = { ...state, cursor: entry.sequence };
        unsaved = true;
        continue;
      }
      const event: WebhookEvent = {
        id: `${repository}:${entry.sequence}`,
        repository,
        sequence: entry.sequence,
        action: entry.action,
        artifactId: entry.artifactId,
        detail: entry.detail,
      };
      try {
        await this.d.sender.send(event, cancellation);
      } catch (error) {
        cancellation.throwIfAborted();
        const failures = state.failures + 1;
        const now = this.d.now();
        await this.d.states.save({
          ...state,
          failures,
          errorCode: failureCode(error),
          errorAt: now,
          nextAttemptAt: new Date(
            Date.parse(now) + webhookBackoffMs(failures, this.d.random),
          ).toISOString(),
        });
        return 'failed';
      }
      delivered++;
      state = {
        ...state,
        cursor: entry.sequence,
        failures: 0,
        errorCode: null,
        errorAt: null,
        nextAttemptAt: null,
        deliveredAt: this.d.now(),
        deliveredCount: state.deliveredCount + 1,
      };
      await this.d.states.save(state);
      unsaved = false;
    }
    if (unsaved) await this.d.states.save(state);
    return delivered > 0 || page.items.length === pageSize ? 'delivered' : 'idle';
  }
}
