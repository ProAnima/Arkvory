import type { DiagnosticLogger } from './diagnostics.js';
import { failureCause, startupReason } from './failure-classification.js';

type CrashOrigin = 'uncaughtException' | 'unhandledRejection';

/**
 * Crash-only policy for service entry points. After an unhandled exception or rejection the
 * process state is unknown (locks, leases, half-written responses), so it is never resumed:
 * one `process.unhandled` record with constant identifiers and a redacted reason is written,
 * the logger gets a bounded moment to flush, and the process exits 1 for the supervisor
 * (systemd, WinSW, compose) to restart it. Returns a function that removes the handlers.
 */
export function installCrashHandlers(
  logger: Pick<DiagnosticLogger, 'write' | 'flush'>,
  exit: (code: number) => void = (code) => process.exit(code),
  flushTimeoutMs = 1000,
): () => void {
  let crashing = false;
  const handler = (origin: CrashOrigin) => (error: unknown) => {
    if (crashing) return;
    crashing = true;
    process.exitCode = 1;
    logger.write({
      level: 'error',
      component: 'process',
      code: 'process.unhandled',
      origin,
      reason: startupReason(error),
      ...failureCause(error),
    });
    void logger.flush(flushTimeoutMs).finally(() => {
      exit(1);
    });
  };
  const exception = handler('uncaughtException');
  const rejection = handler('unhandledRejection');
  process.on('uncaughtException', exception);
  process.on('unhandledRejection', rejection);
  return () => {
    process.off('uncaughtException', exception);
    process.off('unhandledRejection', rejection);
  };
}
