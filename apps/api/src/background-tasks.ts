import type { FastifyInstance } from 'fastify';
import { failureCause } from '@proanima/arkvory-infrastructure';
import type { DiagnosticLogger, DiagnosticRecord } from '@proanima/arkvory-infrastructure';

interface Tasks {
  role: 'api' | 'reader';
  available: () => boolean;
  maintain: () => Promise<void>;
  collect?: () => Promise<void>;
  /** Reads the managed sites (ADR 0077); writer only, one round at a time, aborted on stop. */
  fleet?: (signal: AbortSignal) => Promise<void>;
  /** Rechecks the storages other than `default` (ADR 0083, N11); every role. */
  storage?: () => Promise<void>;
  /** Applies download queue settings saved by another writer (ADR 0076, stage 3). */
  settings?: () => Promise<void>;
  flush: () => Promise<void>;
  close: () => void;
  diagnostics: Pick<DiagnosticLogger, 'write'>;
}

type Failure = Pick<DiagnosticRecord, 'level' | 'component' | 'code'>;

/**
 * One timer: a round never overlaps the previous one; the returned stop waits for it. The signal
 * given to a round is aborted on cancel, so a long round ends instead of outlasting shutdown.
 */
function repeat(
  every: number,
  run: (signal: AbortSignal) => Promise<void>,
  when: () => boolean,
  report: (error: unknown) => void,
) {
  let running: Promise<void> | undefined;
  const stop = new AbortController();
  const timer = setInterval(() => {
    if (running || !when()) return;
    running = run(stop.signal)
      .catch(report)
      .finally(() => {
        running = undefined;
      });
  }, every);
  timer.unref();
  // Two steps for shutdown: every timer stops first, then the running rounds are awaited, so no
  // task starts a new round while another one is being waited for.
  return {
    cancel: () => {
      clearInterval(timer);
      stop.abort();
    },
    finished: () => running ?? Promise.resolve(),
  };
}

/** Timers own no storage; shutdown drains bounded work before the pool is closed. */
export function registerBackgroundTasks(app: FastifyInstance, tasks: Tasks) {
  const stops: ReturnType<typeof repeat>[] = [];
  let stopping: Promise<void> | undefined;
  const writer = (
    every: number,
    run: ((signal: AbortSignal) => Promise<void>) | undefined,
    failure: Failure,
  ) => {
    if (tasks.role !== 'api' || !run) return;
    stops.push(
      repeat(every, run, tasks.available, (error) => {
        tasks.diagnostics.write({ ...failure, ...failureCause(error) });
      }),
    );
  };
  app.addHook('onReady', () => {
    const maintenance = 'maintenance';
    writer(5000, tasks.collect, {
      level: 'error',
      component: maintenance,
      code: 'cleanup.unavailable',
    });
    writer(30000, tasks.fleet, { level: 'warning', component: 'fleet', code: 'fleet.poll_failed' });
    writer(10000, tasks.settings, {
      level: 'warning',
      component: maintenance,
      code: 'downloads.settings_unavailable',
    });
    writer(60000, tasks.maintain, {
      level: 'error',
      component: maintenance,
      code: 'maintenance.unavailable',
    });
    if (tasks.storage)
      stops.push(
        repeat(30000, tasks.storage, tasks.available, (error) => {
          tasks.diagnostics.write({
            level: 'warning',
            component: 'storage',
            code: 'storage.probe_failed',
            ...failureCause(error),
          });
        }),
      );
    // Diagnostics persist on every role.
    stops.push(
      repeat(
        1000,
        tasks.flush,
        () => true,
        () => undefined,
      ),
    );
    return Promise.resolve();
  });
  const drain = async () => {
    try {
      for (const stop of stops) stop.cancel();
      await Promise.all(stops.map((stop) => stop.finished()));
      // One final batch only; stdout already contains all accepted diagnostics.
      await tasks.flush();
    } finally {
      tasks.close();
    }
  };
  return {
    stop: () => {
      stopping ??= drain();
      return stopping;
    },
  };
}
