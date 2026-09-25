import type { FastifyInstance } from 'fastify';
import type { DiagnosticLogger } from '@proanima/depot-infrastructure';

interface Tasks {
  role: 'api' | 'reader';
  available: () => boolean;
  maintain: () => Promise<void>;
  flush: () => Promise<void>;
  close: () => void;
  diagnostics: Pick<DiagnosticLogger, 'write'>;
}

/** Timers own no storage; shutdown drains bounded work before the pool is closed. */
export function registerBackgroundTasks(app: FastifyInstance, tasks: Tasks) {
  let maintenance: Promise<void> | undefined;
  let flushing: Promise<void> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let flushTimer: ReturnType<typeof setInterval> | undefined;
  let stopping: Promise<void> | undefined;
  app.addHook('onReady', () => {
    if (tasks.role === 'api')
      timer = setInterval(() => {
        if (maintenance || !tasks.available()) return;
        maintenance = tasks
          .maintain()
          .catch(() => {
            tasks.diagnostics.write({
              level: 'error',
              component: 'storage',
              code: 'maintenance.unavailable',
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
    try {
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
