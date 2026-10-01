import { DiagnosticLogger, failureCause, startupReason } from '@proanima/arkvory-infrastructure';
import { createServer } from './server.js';
import { loadConfig } from './config.js';
import { RequestDrain, drainThenClose } from './drain.js';
import { defaultDrainTimeoutMs } from './operability-config.js';

// Supervisors (systemd, WinSW, compose) allow 120 s for close after the drain window.
const closeBudgetMs = 120000;

try {
  const config = await loadConfig(process.env);
  const drain = new RequestDrain();
  const app = await createServer(config, {
    drain,
    onOwnershipLost: () => {
      process.stderr.write('Arkvory gateway ownership lost; stopping for supervisor recovery.\n');
      shutdown(true);
    },
  });
  const drainTimeoutMs = config.drainTimeoutMs ?? defaultDrainTimeoutMs;
  const expedite = new AbortController();
  let stopping = false;
  function shutdown(failed = false) {
    if (failed) process.exitCode = 1;
    if (stopping) {
      // A second signal skips the remaining drain window; close keeps its own deadline.
      expedite.abort();
      return;
    }
    stopping = true;
    // A fenced process must stop at once; otherwise admitted transfers may finish first.
    const drainWindowMs = failed ? 0 : drainTimeoutMs;
    const deadline = setTimeout(() => process.exit(1), drainWindowMs + closeBudgetMs);
    deadline.unref();
    void drainThenClose(app, drain, drainWindowMs, expedite.signal).then(
      () => {
        clearTimeout(deadline);
      },
      () => {
        process.exit(1);
      },
    );
  }
  for (const event of ['SIGINT', 'SIGTERM'] as const) {
    process.on(event, () => {
      shutdown();
    });
  }
  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (error) {
    await app.close();
    throw error;
  }
  process.stdout.write(`Arkvory API listening on ${config.host}:${String(config.port)}\n`);
} catch (error) {
  const diagnostics = new DiagnosticLogger(process.stderr, () => new Date().toISOString());
  // Constant identifiers and redacted validation text only; never URLs or credentials.
  diagnostics.write({
    level: 'error',
    component: 'api',
    code: 'startup.failed',
    reason: startupReason(error),
    ...failureCause(error),
  });
  diagnostics.close();
  process.stderr.write(
    'Arkvory startup failed. Check configuration, database migration, and storage access.\n',
  );
  process.exitCode = 1;
}
