import type { CatalogFeedPage } from './catalog-ports.js';
import type { Cancellation } from './ports.js';

/*
 * Ports of webhook delivery (ADR 0069). A subscription follows the change feed of one repository
 * with a cursor of its own and posts each event to a receiver the operator configured. Delivery
 * is at-least-once: the cursor moves only after the receiver answered 2xx, so a crash in between
 * repeats the event under the same `id`.
 */

/** What the receiver gets. Fields of the feed entry plus the repository; no author, no bytes. */
export interface WebhookEvent {
  /** `<repository>:<sequence>`: stable across repeats, the receiver deduplicates by it. */
  readonly id: string;
  readonly repository: string;
  /** Position in the repository feed, a decimal string (64-bit safe). */
  readonly sequence: string;
  readonly action: string;
  readonly artifactId: string;
  /** Asset path or stage, as in the feed. */
  readonly detail: string | null;
}

/** Why a delivery failed, in constant codes only: never a URL, an address or a body. */
export type WebhookFailureCode =
  'blocked' | 'timeout' | 'network' | 'tls' | 'redirect' | 'http_4xx' | 'http_5xx' | 'secret';

export class WebhookFailure extends Error {
  constructor(readonly code: WebhookFailureCode) {
    super(`Webhook delivery failed: ${code}`);
    this.name = 'WebhookFailure';
  }
}

export interface WebhookSender {
  /** Resolves only on a 2xx answer; any other outcome is a WebhookFailure. */
  send(event: WebhookEvent, cancellation: Cancellation): Promise<void>;
}

/** The change feed of a repository (the same read as `GET /repositories/{r}/changes`). */
export interface WebhookFeed {
  changes(repository: string, after: string, limit: number): Promise<CatalogFeedPage>;
}

export interface WebhookState {
  readonly subscription: string;
  /** A subscription pointed at another repository starts again at that feed's head. */
  readonly repository: string;
  /** Sequence of the last event handled (delivered or filtered out). */
  readonly cursor: string;
  readonly failures: number;
  readonly errorCode: WebhookFailureCode | null;
  readonly errorAt: string | null;
  /** No attempt before this instant (backoff); null when healthy. */
  readonly nextAttemptAt: string | null;
  readonly deliveredAt: string | null;
  readonly deliveredCount: number;
}

export interface WebhookStateStore {
  load(subscription: string): Promise<WebhookState | null>;
  save(state: WebhookState): Promise<void>;
  all(): Promise<readonly WebhookState[]>;
}
