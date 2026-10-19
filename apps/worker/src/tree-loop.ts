import { setTimeout as delay } from 'node:timers/promises';
import { TreeIndexer } from '@proanima/arkvory-application';
import type { BlobStore, TreeIndexOutcome } from '@proanima/arkvory-application';
import {
  PostgresContentPins,
  PostgresTreeIndexes,
  ZipTreeBuilder,
  classifyFailure,
} from '@proanima/arkvory-infrastructure';
import type { DiagnosticLogger, PostgresCatalog } from '@proanima/arkvory-infrastructure';

export interface TreeLoopOptions {
  readonly catalog: Pick<PostgresCatalog, 'pool' | 'sessions' | 'active'>;
  readonly blobs: BlobStore;
  readonly stop: AbortSignal;
  readonly diagnostics: Pick<DiagnosticLogger, 'write'>;
  /** Pause after a pass that found less than a full batch (30 s). */
  readonly pollMs?: number;
  /** Archives per pass (10). */
  readonly batch?: number;
}

/** One log line per indexed archive: ids and machine codes only, never paths or names. */
export function reportTreeOutcome(
  diagnostics: Pick<DiagnosticLogger, 'write'>,
  outcome: TreeIndexOutcome,
): void {
  const fields = { component: 'tree', artifactId: outcome.id } as const;
  switch (outcome.kind) {
    case 'ready':
      diagnostics.write({
        level: 'info',
        ...fields,
        code: 'tree.index_built',
        entries: outcome.entries,
      });
      return;
    case 'unavailable':
      diagnostics.write({
        level: 'info',
        ...fields,
        code: 'tree.index_unavailable',
        reason: outcome.reason,
      });
      return;
    case 'failed':
      diagnostics.write({
        level: 'warning',
        ...fields,
        code: 'tree.index_failed',
        errorCode: outcome.errorCode,
        attempts: outcome.attempts,
        retryInSeconds: Math.round(outcome.retryInMs / 1000),
      });
      return;
    case 'skipped':
      return;
  }
}

/**
 * The indexer of one worker process, ready for passes: the content pins hold a session of
 * their own (`catalog.sessions`, like the gateways' pins) and are closed by `close`.
 */
export function treeIndexer(options: Pick<TreeLoopOptions, 'catalog' | 'blobs' | 'batch'>) {
  const pins = new PostgresContentPins(options.catalog.sessions);
  const indexes = new PostgresTreeIndexes(options.catalog.pool);
  const indexer = new TreeIndexer(
    indexes,
    new ZipTreeBuilder(options.blobs, pins),
    indexes,
    () => performance.now(),
    options.batch ?? 10,
  );
  return { indexer, close: () => pins.close() };
}

/**
 * Builds the table of contents of published archives (ADR 0083, N8): a pass at start, then one
 * every `pollMs`, or at once while full batches keep coming. Only the completion worker runs
 * it; a worker that lost storage ownership stops at the next archive. A failed pass (database)
 * is logged with a constant code and repeated on the next tick.
 */
export async function runTreeIndexing(options: TreeLoopOptions): Promise<void> {
  const { catalog, stop, diagnostics } = options;
  const batch = options.batch ?? 10;
  const { indexer, close } = treeIndexer({ ...options, batch });
  // Lost ownership also aborts `stop` (the worker's recovery check), within a second.
  const stopped = () => stop.aborted || !catalog.active;
  try {
    while (!stopped()) {
      let full = false;
      try {
        const outcomes = await indexer.pass(stop, (outcome) => {
          reportTreeOutcome(diagnostics, outcome);
        });
        full = outcomes.length >= batch;
      } catch (error) {
        if (stopped()) break;
        diagnostics.write({
          level: 'warning',
          component: 'tree',
          code: 'tree.pass_failed',
          errorCode:
            classifyFailure(error) === 'dependency_unavailable' ? 'unavailable' : 'internal',
        });
      }
      if (!full)
        await delay(options.pollMs ?? 30_000, undefined, { signal: stop }).catch(() => undefined);
    }
  } finally {
    await close();
  }
}
