import { setTimeout as delay } from 'node:timers/promises';
import { WebhookDelivery } from '@proanima/arkvory-application';
import {
  HttpWebhookSender,
  PostgresWebhookFeed,
  PostgresWebhookState,
  readWebhookSecrets,
} from '@proanima/arkvory-infrastructure';
import type {
  DiagnosticLogger,
  EgressPolicy,
  PostgresCatalog,
  WebhookSettings,
} from '@proanima/arkvory-infrastructure';

export interface WebhookLoopOptions {
  readonly catalog: PostgresCatalog;
  readonly webhooks: readonly WebhookSettings[];
  readonly egress: EgressPolicy;
  /** Authorities for receivers (defaults plus ARKVORY_WEBHOOKS_CA_FILE); absent: defaults. */
  readonly certificates?: readonly string[];
  readonly stop: AbortSignal;
  readonly diagnostics: DiagnosticLogger;
  /** Pause after a step that found nothing to deliver or is backing off. */
  readonly pollMs?: number;
}

async function pause(ms: number, stop: AbortSignal): Promise<void> {
  await delay(ms, undefined, { signal: stop }).catch(() => undefined);
}

/**
 * Delivers one subscription until shutdown or lost storage ownership (ADR 0069). A receiver that
 * is down only slows its own loop: the cursor stays and the step backs off by itself, so uploads
 * and the other subscriptions never wait for it. Log lines carry the subscription id and a
 * constant error code, never the URL, the secret or the body.
 */
async function follow(webhook: WebhookSettings, options: WebhookLoopOptions): Promise<void> {
  const { stop, diagnostics, catalog } = options;
  const fields = { component: 'webhook', subscription: webhook.id } as const;
  const states = new PostgresWebhookState(catalog.pool);
  const delivery = new WebhookDelivery({
    subscription: webhook.id,
    repository: webhook.repository,
    ...(webhook.actions ? { actions: webhook.actions } : {}),
    feed: new PostgresWebhookFeed(catalog.pool),
    sender: new HttpWebhookSender({
      url: webhook.url,
      policy: options.egress,
      secrets: () =>
        readWebhookSecrets(
          webhook.nextSecretFile
            ? [webhook.secretFile, webhook.nextSecretFile]
            : [webhook.secretFile],
        ),
      nowSeconds: () => Math.floor(Date.now() / 1000),
      ...(options.certificates ? { ca: options.certificates } : {}),
    }),
    states,
    now: () => new Date().toISOString(),
    random: Math.random,
  });
  const cancellation = {
    throwIfAborted: () => {
      stop.throwIfAborted();
    },
  };
  // A function, not the property: the flag changes outside this loop.
  const stopped = () => stop.aborted;
  diagnostics.write({
    level: 'info',
    ...fields,
    repository: webhook.repository,
    code: 'webhook.started',
  });
  let failing = 0;
  while (!stop.aborted && catalog.active) {
    try {
      const step = await delivery.step(cancellation);
      if (step === 'failed') {
        const state = await states.load(webhook.id);
        failing = state?.failures ?? failing + 1;
        diagnostics.write({
          level: 'warning',
          ...fields,
          code: 'webhook.step_failed',
          errorCode: state?.errorCode ?? 'network',
          attempts: failing,
        });
      } else if (failing > 0) {
        diagnostics.write({
          level: 'info',
          ...fields,
          code: 'webhook.recovered',
          attempts: failing,
        });
        failing = 0;
      }
      if (step !== 'delivered') await pause(options.pollMs ?? 5000, stop);
    } catch (error) {
      if (stopped()) break;
      failing++;
      // A feed or state read failed (database): a constant code, the error text may hold SQL.
      diagnostics.write({
        level: 'warning',
        ...fields,
        code: 'webhook.step_failed',
        errorCode:
          error instanceof Error && error.name === 'ArkvoryError' ? 'unavailable' : 'internal',
        attempts: failing,
      });
      await pause(options.pollMs ?? 5000, stop);
    }
  }
  diagnostics.write({ level: 'info', ...fields, code: 'webhook.stopped' });
}

/**
 * Every subscription runs its own loop; one failing receiver stops none of the others. The
 * positions of subscriptions that are no longer configured are forgotten first (also when none
 * is configured any more); a failing cleanup only leaves them for the next start.
 */
export async function runWebhooks(options: WebhookLoopOptions): Promise<void> {
  await new PostgresWebhookState(options.catalog.pool)
    .prune(options.webhooks.map((webhook) => webhook.id))
    .catch(() => {
      options.diagnostics.write({
        level: 'warning',
        component: 'webhook',
        code: 'webhook.prune_failed',
      });
    });
  if (options.webhooks.length === 0) return;
  await Promise.all(options.webhooks.map((webhook) => follow(webhook, options)));
}
