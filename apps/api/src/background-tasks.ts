import type { FastifyInstance } from 'fastify';
import { failureCause } from '@proanima/arkvory-infrastructure';
import type { DiagnosticLogger } from '@proanima/arkvory-infrastructure';

interface Tasks {
  role: 'api' | 'reader';
  available: () => boolean;
  maintain: () => Promise<void>;
  collect?: () => Promise<void>;
  /** Reads the managed sites (ADR 0077); writer only, one round at a time. */
  fleet?: () => Promise<void>;
  flush: () => Promise<void>;
  close: () => void;
  diagnostics: Pick<DiagnosticLogger, 'write'>;
}

/** Timers own no storage; shutdown drains bounded work before the pool is closed. */
export function registerBackgroundTasks(app: FastifyInstance, tasks: Tasks) {
  let maintenance: Promise<void> | undefined;
  let flushing: Promise<void> | undefined;
  let collecting: Promise<void> | undefined;
  let polling: Promise<void> | undefined;
  let fleetTimer: ReturnType<typeof setInterval> | undefined;
  let collectionTimer: ReturnType<typeof setInterval> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let flushTimer: ReturnType<typeof setInterval> | undefined;
  let stopping: Promise<void> | undefined;
  app.addHook('onReady', () => {
    if (tasks.role === 'api' && tasks.collect) {
      collectionTimer = setInterval(() => {
        if (collecting || !tasks.available()) return;
        collecting = tasks
          .collect?.()
          .catch((error: unknown) => {
            tasks.diagnostics.write({
              level: 'error',
              component: 'maintenance',
              code: 'cleanup.unavailable',
              ...failureCause(error),
            });
          })
          .finally(() => {
            collecting = undefined;
          });
      }, 5000);
      collectionTimer.unref();
    }
    const fleet = tasks.fleet;
    if (tasks.role === 'api' && fleet) {
      fleetTimer = setInterval(() => {
        if (polling || !tasks.available()) return;
        polling = fleet()
          .catch((error: unknown) => {
            tasks.diagnostics.write({
              level: 'warning',
              component: 'fleet',
              code: 'fleet.poll_failed',
              ...failureCause(error),
            });
          })
          .finally(() => {
            polling = undefined;
          });
      }, 30000);
      fleetTimer.unref();
    }
    if (tasks.role === 'api')
      timer = setInterval(() => {
        if (maintenance || !tasks.available()) return;
        maintenance = tasks
          .maintain()
          .catch((error: unknown) => {
            tasks.diagnostics.write({
              level: 'error',
              component: 'maintenance',
              code: 'maintenance.unavailable',
              ...failureCause(error),
            });
          })
          .finally(() => {
            maintenance = undefined;
          });
      }, 60000);
    flushTimer = setInterval(() => {
      if (!flushing)
        flushing = tasks.flush().finally(() => {
          flushing = undefined;
        });
    }, 1000);
    timer?.unref();
    flushTimer.unref();
    return Promise.resolve();
  });
  const drain = async () => {
    clearInterval(timer);
    clearInterval(flushTimer);
    clearInterval(collectionTimer);
    clearInterval(fleetTimer);
    try {
      await collecting;
      await polling;
      await maintenance;
      await flushing;
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
