import { setTimeout as delay } from 'node:timers/promises';
import { RehomeBlobs } from '@proanima/arkvory-application';
import type { ClaimedMove } from '@proanima/arkvory-application';
import { ArkvoryError } from '@proanima/arkvory-domain';
import {
  MOVE_LEASE_SECONDS,
  PostgresBlobMoves,
  PostgresContentPins,
  PostgresCopyRemoval,
  PostgresUploadSwitch,
  failureCause,
  pacedCopy,
  takeRehomeSingleton,
} from '@proanima/arkvory-infrastructure';
import type {
  DiagnosticFields,
  DiagnosticLogger,
  PostgresCatalog,
  RehomeSingleton,
  StorageBackends,
} from '@proanima/arkvory-infrastructure';

/** Moves one worker runs at once (ADR 0083, N2). */
export const REHOME_PARALLEL = 2;
const IDLE_MS = 5000;

/** ARKVORY_REHOME_BYTES_PER_SECOND: the copy budget of all moves; 0 or absent is no limit. */
export function rehomeBytesPerSecond(value: string | undefined): number {
  if (value === undefined || value === '') return 0;
  if (!/^(0|[1-9][0-9]{0,15})$/.test(value) || !Number.isSafeInteger(Number(value)))
    throw new Error('Invalid ARKVORY_REHOME_BYTES_PER_SECOND');
  return Number(value);
}

export interface RehomeLoopOptions {
  readonly catalog: PostgresCatalog;
  readonly blobs: StorageBackends;
  readonly stop: AbortSignal;
  readonly diagnostics: Pick<DiagnosticLogger, 'write'>;
  readonly bytesPerSecond: number;
}

/**
 * Moves of published blobs between storages (ADR 0083, N2), planned by `arkvory storage
 * rehome`: one process at a time (18471/22), `REHOME_PARALLEL` moves at once, each run under its
 * lease, renewed every third of it with the move's current state. A lost lease, singleton or
 * worker ownership stops the move's work; another attempt picks it up later.
 */
export async function runRehome(options: RehomeLoopOptions): Promise<void> {
  const { catalog, blobs, stop, diagnostics } = options;
  const pool = catalog.pool;
  const moves = new PostgresBlobMoves(pool);
  const pins = new PostgresContentPins(catalog.sessions);
  const rehome = new RehomeBlobs(
    moves,
    new PostgresUploadSwitch(pool),
    new PostgresCopyRemoval(pool, blobs),
    blobs,
    blobs,
    pins,
    pacedCopy(options.bytesPerSecond),
  );
  let singleton: RehomeSingleton | null = null;
  const log = (
    level: 'debug' | 'info' | 'warning' | 'error',
    code: string,
    fields: DiagnosticFields = {},
  ) => {
    diagnostics.write({ level, component: 'worker', code, ...fields });
  };
  try {
    while (!stop.aborted && catalog.active) {
      try {
        if (singleton && !singleton.active) singleton = null;
        singleton ??= await takeRehomeSingleton(catalog.sessions);
        const held = singleton;
        const claimed = held ? await moves.claim(REHOME_PARALLEL) : [];
        if (held && claimed.length > 0) {
          await Promise.all(claimed.map((move) => drive(move, held)));
          continue;
        }
      } catch (error) {
        log('error', 'storage.move_loop_failed', failureCause(error));
      }
      await delay(IDLE_MS, undefined, { signal: stop }).catch(() => undefined);
    }
  } finally {
    await singleton?.close();
    await pins.close();
  }

  async function drive(move: ClaimedMove, held: RehomeSingleton): Promise<void> {
    let current = move;
    let lost = false;
    const renew = setInterval(
      () => {
        moves.heartbeat(current).then(
          (kept) => {
            lost ||= !kept;
          },
          () => {
            lost = true;
          },
        );
      },
      (MOVE_LEASE_SECONDS * 1000) / 3,
    );
    renew.unref();
    const cancellation = {
      throwIfAborted() {
        stop.throwIfAborted();
        if (lost || !held.active || !catalog.active)
          throw new ArkvoryError('unavailable', 'Move lease lost');
      },
    };
    const fields = { uploadId: move.uploadId, backend: move.to };
    try {
      const run = await rehome.run(move, cancellation, (next) => {
        current = next;
      });
      if (run.outcome === 'done')
        log(
          'info',
          run.state === 'skipped' ? 'storage.move_skipped' : 'storage.move_completed',
          fields,
        );
      else if (run.outcome === 'failed')
        log('warning', 'storage.move_failed', { ...fields, reason: run.state });
      else log('debug', `storage.move_${run.outcome}`, { ...fields, reason: run.state });
    } catch (error) {
      log('warning', 'storage.move_interrupted', { ...fields, ...failureCause(error) });
    } finally {
      clearInterval(renew);
    }
  }
}
