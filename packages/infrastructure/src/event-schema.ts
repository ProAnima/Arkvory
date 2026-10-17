import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

export const EVENTS_MIGRATION = 42;

/**
 * Expand-only (ADR 0080): the event outbox and its single state row. Writers insert events with
 * a NULL position in the transaction of the change; only the sequencer numbers them, so readers
 * never see a lower position appear after a higher one. `head` is the last position given and
 * `pruned_through` the last position retention removed: positions are dense between the two.
 * The epoch is new for every database this migration creates, a restored one included, because
 * both tables stay out of backups: consumers learn about a restore from the changed epoch.
 */
export async function migrateEvents(client: PoolClient): Promise<void> {
  if (
    (
      await client.query('SELECT version FROM arkvory_migrations WHERE version=$1', [
        EVENTS_MIGRATION,
      ])
    ).rowCount
  )
    return;
  await client.query(`
    CREATE TABLE arkvory_event_state(
      singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
      epoch uuid NOT NULL,
      head bigint NOT NULL DEFAULT 0 CHECK (head >= 0),
      pruned_through bigint NOT NULL DEFAULT 0 CHECK (pruned_through >= 0 AND pruned_through <= head),
      pruned_total bigint NOT NULL DEFAULT 0 CHECK (pruned_total >= 0),
      sequenced_at timestamptz,
      pruned_at timestamptz
    )`);
  await client.query('INSERT INTO arkvory_event_state(epoch) VALUES($1)', [randomUUID()]);
  await client.query(`
    CREATE TABLE arkvory_events(
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      position bigint UNIQUE CHECK (position > 0),
      type text NOT NULL,
      schema_version integer NOT NULL CHECK (schema_version > 0),
      scope text NOT NULL CHECK (scope IN ('repository','system')),
      repository text,
      partition_key text NOT NULL,
      subject text NOT NULL,
      labels text[] NOT NULL DEFAULT '{}',
      occurred_at timestamptz NOT NULL DEFAULT now(),
      data jsonb NOT NULL,
      CHECK ((scope = 'repository') = (repository IS NOT NULL))
    )`);
  // The sequencer's backlog: small, read in id order.
  await client.query(
    'CREATE INDEX arkvory_events_unsequenced ON arkvory_events(id) WHERE position IS NULL',
  );
  await client.query('INSERT INTO arkvory_migrations(version) VALUES($1)', [EVENTS_MIGRATION]);
}
