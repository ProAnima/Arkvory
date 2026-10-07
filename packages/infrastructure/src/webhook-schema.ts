import type { PoolClient } from 'pg';

export const WEBHOOK_STATE_MIGRATION = 33;

/**
 * Expand-only (ADR 0069): one row per webhook subscription of this installation. `cursor` is the
 * feed sequence of the last event handled; `repository` binds the row to the feed it follows, so
 * a subscription pointed elsewhere starts at that feed's head. `next_attempt_at` is the backoff
 * after a failed delivery.
 */
export async function migrateWebhookState(client: PoolClient): Promise<void> {
  if (
    (
      await client.query('SELECT version FROM arkvory_migrations WHERE version=$1', [
        WEBHOOK_STATE_MIGRATION,
      ])
    ).rowCount
  )
    return;
  await client.query(`
    CREATE TABLE arkvory_webhook_state(
      subscription text PRIMARY KEY,
      repository text NOT NULL,
      cursor bigint NOT NULL DEFAULT 0 CHECK (cursor >= 0),
      failures integer NOT NULL DEFAULT 0 CHECK (failures >= 0),
      error_code text,
      error_at timestamptz,
      next_attempt_at timestamptz,
      delivered_at timestamptz,
      delivered_count bigint NOT NULL DEFAULT 0 CHECK (delivered_count >= 0),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
  await client.query('INSERT INTO arkvory_migrations(version) VALUES($1)', [
    WEBHOOK_STATE_MIGRATION,
  ]);
}
