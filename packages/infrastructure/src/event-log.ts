import type { Pool, PoolClient } from 'pg';
import { EVENT_SEQUENCE_BATCH, pruneThrough } from '@proanima/arkvory-domain';
import type { EventScope } from '@proanima/arkvory-domain';
import type {
  EventLogPage,
  EventLogQuery,
  EventLogReader,
  EventRecord,
} from '@proanima/arkvory-application';
import { inTransaction } from './pg-transaction.js';

interface StateRow {
  epoch: string;
  head: string;
  pruned_through: string;
}
interface EventRow {
  position: string;
  type: string;
  schema_version: number;
  scope: string;
  repository: string | null;
  partition_key: string;
  subject: string;
  occurred_at: Date;
  data: unknown;
}

/** Event feed retention (ADR 0080): ARKVORY_EVENTS_RETENTION_HOURS and ARKVORY_EVENTS_MAX_ROWS. */
export interface EventRetentionPolicy {
  readonly hours: number;
  readonly maxRows: bigint;
}
/** Gauges of the outbox for the API metrics (ADR 0080, section 7). */
export interface EventLogSnapshot {
  readonly head: bigint;
  readonly oldest: bigint;
  readonly prunedTotal: bigint;
  /** Age of the oldest event still without a position; 0 when every event has one. */
  readonly unsequencedAgeSeconds: number;
}

const scopeOf = (value: string): EventScope => (value === 'system' ? 'system' : 'repository');
function objectOf(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};
}
const recordOf = (row: EventRow): EventRecord => ({
  position: BigInt(row.position),
  type: row.type,
  schemaVersion: row.schema_version,
  scope: scopeOf(row.scope),
  repository: row.repository,
  partitionKey: row.partition_key,
  subject: row.subject,
  occurredAt: row.occurred_at.toISOString(),
  data: objectOf(row.data),
});

async function lockedState(client: PoolClient): Promise<StateRow & { now_ms: number }> {
  const state = await client.query<StateRow & { now_ms: number }>(
    `SELECT epoch::text, head::text, pruned_through::text,
       (extract(epoch FROM now()) * 1000)::float8 AS now_ms
     FROM arkvory_event_state FOR UPDATE`,
  );
  const row = state.rows[0];
  if (!row) throw new Error('Event state row is missing; run migrate');
  return row;
}

/*
 * ORDER BY names the table column: a bare name would sort by the `::text` output column of the
 * same name, so '10' would come before '9' (PostgreSQL resolves ORDER BY to output names first).
 */

/**
 * The event outbox in PostgreSQL (ADR 0080). Sequencing and retention both lock the single
 * state row first, so they run one at a time across processes: positions are handed out by
 * consecutive committed transactions and a reader that saw position P never later sees a new
 * event below P. Reads take one REPEATABLE READ snapshot for the window and the rows.
 */
export class PostgresEventLog implements EventLogReader {
  constructor(private readonly pool: Pool) {}

  read(query: EventLogQuery): Promise<EventLogPage> {
    return inTransaction(this.pool, async (client) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
      const state = await client.query<StateRow>(
        'SELECT epoch::text, head::text, pruned_through::text FROM arkvory_event_state',
      );
      const row = state.rows[0];
      if (!row) throw new Error('Event state row is missing; run migrate');
      const after = query.after ?? BigInt(row.pruned_through);
      // The scan bound is applied before visibility, so a narrow caller costs the same as an
      // administrator and the cursor moves past events it may not see.
      const scanned =
        'SELECT * FROM arkvory_events WHERE position > $1::bigint ORDER BY position LIMIT $2';
      const items = await client.query<EventRow>(
        `SELECT position::text, type, schema_version, scope, repository, partition_key, subject,
           occurred_at, data
         FROM (${scanned}) s
         WHERE ((scope='repository' AND repository=ANY($3::text[])) OR (scope='system' AND $4::boolean))
           AND ($5::text[] IS NULL OR type=ANY($5::text[]))
         ORDER BY s.position LIMIT $6`,
        [String(after), query.scan, query.repositories, query.system, query.types, query.limit],
      );
      const frontier = await client.query<{ through: string | null }>(
        `SELECT max(position)::text AS through FROM (
           SELECT position FROM arkvory_events WHERE position > $1 ORDER BY position LIMIT $2) s`,
        [String(after), query.scan],
      );
      const through = frontier.rows[0]?.through ?? null;
      return {
        epoch: row.epoch,
        head: BigInt(row.head),
        oldest: BigInt(row.pruned_through),
        after,
        items: items.rows.map(recordOf),
        scannedThrough: through === null ? null : BigInt(through),
      };
    });
  }

  /**
   * Numbers up to `limit` committed events without a position in id order and returns how many.
   * Idempotent: a crash before COMMIT leaves every row unnumbered and the head unchanged.
   */
  sequence(limit = EVENT_SEQUENCE_BATCH): Promise<number> {
    return inTransaction(this.pool, async (client) => {
      const state = await lockedState(client);
      const pending = await client.query<{ id: string }>(
        'SELECT id::text FROM arkvory_events WHERE position IS NULL ORDER BY arkvory_events.id LIMIT $1',
        [limit],
      );
      const ids = pending.rows.map((row) => row.id);
      if (ids.length === 0) return 0;
      await client.query(
        `UPDATE arkvory_events e SET position=$1::bigint + t.ordinal
         FROM unnest($2::bigint[]) WITH ORDINALITY AS t(id, ordinal) WHERE e.id=t.id`,
        [state.head, ids],
      );
      await client.query('UPDATE arkvory_event_state SET head=head + $1, sequenced_at=now()', [
        ids.length,
      ]);
      return ids.length;
    });
  }

  /** Deletes one batch of the oldest events past the policy; returns how many went. */
  prune(policy: EventRetentionPolicy): Promise<number> {
    return inTransaction(this.pool, async (client) => {
      const state = await lockedState(client);
      const oldest = await client.query<{ position: string; at_ms: number }>(
        `SELECT position::text, (extract(epoch FROM occurred_at) * 1000)::float8 AS at_ms
         FROM arkvory_events WHERE position > $1 ORDER BY arkvory_events.position LIMIT $2`,
        [state.pruned_through, EVENT_SEQUENCE_BATCH],
      );
      const through = pruneThrough({
        batch: oldest.rows.map((row) => ({
          position: BigInt(row.position),
          occurredAtMs: row.at_ms,
        })),
        retained: BigInt(state.head) - BigInt(state.pruned_through),
        maxRows: policy.maxRows,
        cutoffMs: state.now_ms - policy.hours * 3600 * 1000,
      });
      if (through === null) return 0;
      const deleted = await client.query(
        'DELETE FROM arkvory_events WHERE position > $1 AND position <= $2',
        [state.pruned_through, String(through)],
      );
      const count = deleted.rowCount ?? 0;
      await client.query(
        `UPDATE arkvory_event_state
         SET pruned_through=$1, pruned_total=pruned_total + $2, pruned_at=now()`,
        [String(through), count],
      );
      return count;
    });
  }

  async snapshot(): Promise<EventLogSnapshot> {
    const result = await this.pool.query<{
      head: string;
      pruned_through: string;
      pruned_total: string;
      age: number | null;
    }>(
      `SELECT head::text, pruned_through::text, pruned_total::text,
         (SELECT extract(epoch FROM now() - occurred_at)::float8 FROM arkvory_events
           WHERE position IS NULL ORDER BY id LIMIT 1) AS age
       FROM arkvory_event_state`,
    );
    const row = result.rows[0];
    if (!row) throw new Error('Event state row is missing; run migrate');
    return {
      head: BigInt(row.head),
      oldest: BigInt(row.pruned_through),
      prunedTotal: BigInt(row.pruned_total),
      unsequencedAgeSeconds: Math.max(0, row.age ?? 0),
    };
  }
}
