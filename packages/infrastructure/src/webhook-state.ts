import type { Pool } from 'pg';
import type {
  CatalogFeedPage,
  WebhookFailureCode,
  WebhookFeed,
  WebhookState,
  WebhookStateStore,
} from '@proanima/arkvory-application';
import { readCatalogChanges } from './catalog-audit.js';

/** The repository change feed read straight from the journal, as `GET .../changes` reads it. */
export class PostgresWebhookFeed implements WebhookFeed {
  constructor(private readonly pool: Pool) {}

  changes(repository: string, after: string, limit: number): Promise<CatalogFeedPage> {
    return readCatalogChanges(this.pool, repository, after, limit);
  }
}

interface StateRow {
  subscription: string;
  repository: string;
  cursor: string;
  failures: number;
  error_code: WebhookFailureCode | null;
  error_at: Date | null;
  next_attempt_at: Date | null;
  delivered_at: Date | null;
  delivered_count: string;
}

const columns = `subscription, repository, cursor::text, failures, error_code, error_at,
  next_attempt_at, delivered_at, delivered_count::text`;
const iso = (value: Date | null) => (value ? value.toISOString() : null);

function decode(row: StateRow): WebhookState {
  return {
    subscription: row.subscription,
    repository: row.repository,
    cursor: row.cursor,
    failures: row.failures,
    errorCode: row.error_code,
    errorAt: iso(row.error_at),
    nextAttemptAt: iso(row.next_attempt_at),
    deliveredAt: iso(row.delivered_at),
    deliveredCount: Number(row.delivered_count),
  };
}

/** Delivery state of webhook subscriptions (schema 33, ADR 0069). */
export class PostgresWebhookState implements WebhookStateStore {
  constructor(private readonly pool: Pool) {}

  async load(subscription: string): Promise<WebhookState | null> {
    const result = await this.pool.query<StateRow>(
      `SELECT ${columns} FROM arkvory_webhook_state WHERE subscription=$1`,
      [subscription],
    );
    const row = result.rows[0];
    return row ? decode(row) : null;
  }

  async all(): Promise<readonly WebhookState[]> {
    const result = await this.pool.query<StateRow>(
      `SELECT ${columns} FROM arkvory_webhook_state ORDER BY subscription`,
    );
    return result.rows.map(decode);
  }

  /** One writer per subscription (the worker that owns the storage), so a plain upsert suffices. */
  async save(state: WebhookState): Promise<void> {
    await this.pool.query(
      `INSERT INTO arkvory_webhook_state(subscription, repository, cursor, failures, error_code,
         error_at, next_attempt_at, delivered_at, delivered_count, updated_at)
       VALUES($1,$2,$3::bigint,$4,$5,$6,$7,$8,$9::bigint,now())
       ON CONFLICT (subscription) DO UPDATE SET repository=excluded.repository,
         cursor=excluded.cursor, failures=excluded.failures, error_code=excluded.error_code,
         error_at=excluded.error_at, next_attempt_at=excluded.next_attempt_at,
         delivered_at=excluded.delivered_at, delivered_count=excluded.delivered_count,
         updated_at=now()`,
      [
        state.subscription,
        state.repository,
        state.cursor,
        state.failures,
        state.errorCode,
        state.errorAt,
        state.nextAttemptAt,
        state.deliveredAt,
        String(state.deliveredCount),
      ],
    );
  }
}
