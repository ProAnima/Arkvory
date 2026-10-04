import {
  DiagnosticLogger,
  failureCause,
  installCrashHandlers,
  parseLogLevel,
  processIdentity,
  startEventLoopWatchdog,
  watchdogSeconds,
  readReleaseVersion,
  startupReason,
} from '@proanima/arkvory-infrastructure';
import type { LogLevel } from '@proanima/arkvory-infrastructure';
import { createServer } from './server.js';
import { plaintextExposed } from './tls-config.js';
import { loadConfig } from './config.js';
import { RequestDrain } from './drain.js';
import { defaultDrainTimeoutMs } from './operability-config.js';
import { createShutdown } from './shutdown.js';
import type { ShutdownRequest } from './shutdown.js';
import { RecentLog } from './recent-log.js';

// Supervisors (systemd, WinSW, compose) allow 120 s for close after the drain window.
const closeBudgetMs = 120000;

/** An invalid level still fails startup through loadConfig; until then info applies. */
function initialLevel(): LogLevel {
  try {
    return parseLogLevel(process.env['ARKVORY_LOG_LEVEL']);
  } catch {
    return 'info';
  }
}

// releases/<version>/apps/api/dist/main.js -> releases/<version>/release.json
const identity = processIdentity(
  'api',
  await readReleaseVersion(new URL('../../../release.json', import.meta.url)),
);
// One logger per process: lifecycle, HTTP and crash records share its backpressure accounting.
// Its newest lines stay in memory for feedback reports of administrators (ADR 0060).
const recentLog = new RecentLog(process.stdout);
const diagnostics = new DiagnosticLogger(recentLog, () => new Date().toISOString(), {
  level: initialLevel(),
  process: identity,
});
installCrashHandlers(diagnostics);

try {
  startEventLoopWatchdog({
    seconds: watchdogSeconds(process.env['ARKVORY_WATCHDOG_SECONDS']),
    fields: identity,
    onError: (error) => {
      diagnostics.write({
        level: 'warning',
        component: 'process',
        code: 'process.watchdog_failed',
        ...failureCause(error),
      });
    },
  });
  const config = await loadConfig(process.env);
  const drain = new RequestDrain();
  let shutdown: (request: ShutdownRequest) => void = () => undefined;
  const app = await createServer(config, {
    drain,
    diagnostics,
    recentLog,
    identity,
    onOwnershipLost: () => {
      process.exitCode = 1;
      diagnostics.write({ level: 'error', component: 'process', code: 'api.ownership_lost' });
      shutdown({ failed: true });
    },
  });
  shutdown = createShutdown({
    app,
    drain,
    drainTimeoutMs: config.drainTimeoutMs ?? defaultDrainTimeoutMs,
    closeBudgetMs,
    diagnostics,
    now: () => performance.now(),
    exit: (code) => process.exit(code),
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.on(signal, () => {
      shutdown({ signal });
    });
  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (error) {
    await app.close();
    throw error;
  }
  const bound = app.server.address();
  diagnostics.write({
    level: 'info',
    component: 'process',
    code: 'api.listening',
    address: config.host,
    port: typeof bound === 'object' && bound ? bound.port : config.port,
    tls: Boolean(config.tls),
  });
  if (plaintextExposed(config.host, Boolean(config.tls), config.trustedProxies ?? []))
    diagnostics.write({
      level: 'warning',
      component: 'process',
      code: 'http.plaintext_exposed',
      address: config.host,
    });
} catch (error) {
  // Constant identifiers and redacted validation text only; never URLs or credentials.
  diagnostics.write({
    level: 'error',
    component: 'process',
    code: 'startup.failed',
    reason: startupReason(error),
    ...failureCause(error),
  });
  process.stderr.write(
    'Arkvory startup failed. Check configuration, database migration, and storage access.\n',
  );
  process.exitCode = 1;
}
