import type { DiagnosticLogger } from '@proanima/arkvory-infrastructure';
import { failureCause } from '@proanima/arkvory-infrastructure';
import { drainThenClose } from './drain.js';
import type { RequestDrain } from './drain.js';

export interface ShutdownOptions {
  readonly app: { close(): PromiseLike<unknown> };
  readonly drain: RequestDrain;
  readonly drainTimeoutMs: number;
  /** Supervisors (systemd, WinSW, compose) allow 120 s for close after the drain window. */
  readonly closeBudgetMs: number;
  readonly diagnostics: Pick<DiagnosticLogger, 'write' | 'flush'>;
  /** Monotonic milliseconds. */
  readonly now: () => number;
  readonly exit: (code: number) => void;
}
export interface ShutdownRequest {
  readonly signal?: string;
  /** Lost ownership: stop at once without a drain window; the caller sets the exit code. */
  readonly failed?: boolean;
}

/**
 * One graceful stop per process. The first request drains then closes; a second request skips
 * the rest of the drain window (close keeps its own deadline). Every phase is logged with its
 * duration so an operator can tell a clean drain from a timeout or a forced exit.
 */
export function createShutdown(options: ShutdownOptions): (request: ShutdownRequest) => void {
  const { app, drain, diagnostics, now, exit } = options;
  const expedite = new AbortController();
  let stopping = false;
  const fail = (code: string, error?: unknown) => {
    diagnostics.write({
      level: 'error',
      component: 'process',
      code,
      ...(error === undefined ? {} : failureCause(error)),
    });
    void diagnostics.flush(500).finally(() => {
      exit(1);
    });
  };
  return (request) => {
    const signal = request.signal ? { signal: request.signal } : {};
    if (stopping) {
      diagnostics.write({
        level: 'info',
        component: 'process',
        code: 'drain.expedited',
        ...signal,
      });
      expedite.abort();
      return;
    }
    stopping = true;
    const drainWindowMs = request.failed ? 0 : options.drainTimeoutMs;
    const started = now();
    const elapsed = () => Math.max(0, Math.round(now() - started));
    diagnostics.write({
      level: 'info',
      component: 'process',
      code: 'drain.started',
      drainWindowMs,
      activeRequests: drain.activeRequests,
      ...signal,
    });
    const deadline = setTimeout(() => {
      fail('api.stop_timeout');
    }, drainWindowMs + options.closeBudgetMs);
    deadline.unref();
    const settledHook = (settled: boolean) => {
      diagnostics.write(
        settled
          ? { level: 'info', component: 'process', code: 'drain.settled', durationMs: elapsed() }
          : {
              level: 'warning',
              component: 'process',
              code: 'drain.timeout',
              durationMs: elapsed(),
              activeRequests: drain.activeRequests,
            },
      );
    };
    void drainThenClose(app, drain, drainWindowMs, expedite.signal, settledHook).then(
      () => {
        clearTimeout(deadline);
        diagnostics.write({
          level: 'info',
          component: 'process',
          code: 'api.stopped',
          durationMs: elapsed(),
        });
      },
      (error: unknown) => {
        clearTimeout(deadline);
        fail('api.stop_failed', error);
      },
    );
  };
}
