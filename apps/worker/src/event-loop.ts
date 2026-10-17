import { setTimeout as delay } from 'node:timers/promises';
import { EVENT_SEQUENCE_BATCH } from '@proanima/arkvory-domain';
import { PostgresEventLog, classifyFailure } from '@proanima/arkvory-infrastructure';
import type {
  DiagnosticLogger,
  EventRetentionPolicy,
  PostgresCatalog,
} from '@proanima/arkvory-infrastructure';

export const DEFAULT_EVENT_RETENTION: EventRetentionPolicy = { hours: 168, maxRows: 5_000_000n };

/** ARKVORY_EVENTS_RETENTION_HOURS (1–8760) and ARKVORY_EVENTS_MAX_ROWS (1000–1e9), ADR 0080. */
export function readEventRetention(
  env: Readonly<Record<string, string | undefined>>,
): EventRetentionPolicy {
  const hours = env['ARKVORY_EVENTS_RETENTION_HOURS'];
  const rows = env['ARKVORY_EVENTS_MAX_ROWS'];
  if (hours !== undefined && (!/^[1-9][0-9]{0,3}$/.test(hours) || Number(hours) > 8760))
    throw new Error('Invalid ARKVORY_EVENTS_RETENTION_HOURS: whole hours from 1 to 8760');
  if (rows !== undefined && (!/^[1-9][0-9]{3,9}$/.test(rows) || BigInt(rows) > 1_000_000_000n))
    throw new Error('Invalid ARKVORY_EVENTS_MAX_ROWS: a whole number from 1000 to 1000000000');
  return {
    hours: hours === undefined ? DEFAULT_EVENT_RETENTION.hours : Number(hours),
    maxRows: rows === undefined ? DEFAULT_EVENT_RETENTION.maxRows : BigInt(rows),
  };
}

export interface EventLoopOptions {
  readonly catalog: PostgresCatalog;
  readonly retention: EventRetentionPolicy;
  readonly stop: AbortSignal;
  readonly diagnostics: Pick<DiagnosticLogger, 'write'>;
  /** Pause between sequencer steps (ADR 0080: 500 ms). */
  readonly tickMs?: number;
  /** Pause between retention passes. */
  readonly pruneEveryMs?: number;
  readonly now?: () => number;
}

/** Batches one tick may number or delete: a backlog never starves the other step. */
const batchesPerTick = 20;

/**
 * The single event sequencer (ADR 0080), a loop of the completion worker: only the process that
 * holds the worker lock runs it. Storage ownership is checked before every transaction, so a
 * worker that lost it stops numbering at once; even two sequencers would stay correct, because
 * every transaction locks the state row first. A failed step is logged with a constant code
 * and repeated on the next tick; nothing is lost, the events wait without a position.
 */
export async function runEventSequencer(options: EventLoopOptions): Promise<void> {
  const { catalog, stop, diagnostics } = options;
  const log = new PostgresEventLog(catalog.pool);
  const now = options.now ?? (() => performance.now());
  const stopped = () => stop.aborted || !catalog.active;
  let prunedAt = Number.NEGATIVE_INFINITY;
  let attempts = 0;
  while (!stopped()) {
    try {
      for (let batch = 0; batch < batchesPerTick && !stopped(); batch++)
        if ((await log.sequence()) < EVENT_SEQUENCE_BATCH) break;
      if (now() - prunedAt >= (options.pruneEveryMs ?? 60_000)) {
        let rows = 0;
        for (let batch = 0; batch < batchesPerTick && !stopped(); batch++) {
          const pruned = await log.prune(options.retention);
          rows += pruned;
          if (pruned === 0) break;
        }
        prunedAt = now();
        if (rows > 0)
          diagnostics.write({ level: 'info', component: 'events', code: 'events.pruned', rows });
      }
      if (attempts > 0)
        diagnostics.write({
          level: 'info',
          component: 'events',
          code: 'events.recovered',
          attempts,
        });
      attempts = 0;
    } catch (error) {
      if (stopped()) break;
      attempts++;
      // A constant code: the error text of a database failure may hold SQL.
      diagnostics.write({
        level: 'warning',
        component: 'events',
        code: 'events.step_failed',
        errorCode: classifyFailure(error) === 'dependency_unavailable' ? 'unavailable' : 'internal',
        attempts,
      });
    }
    await delay(options.tickMs ?? 500, undefined, { signal: stop }).catch(() => undefined);
  }
}
