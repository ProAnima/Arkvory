import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { StorageService } from '@proanima/arkvory-application';
import { ArkvoryError } from '@proanima/arkvory-domain';
import {
  DiagnosticLogger,
  failureCause,
  installCrashHandlers,
  parseLogLevel,
  processIdentity,
  readReleaseVersion,
  startupReason,
  PostgresJobs,
  PostgresIdentity,
  PostgresServices,
  readMirrorSettings,
  startEventLoopWatchdog,
  trustMirrorCertificates,
  watchdogSeconds,
} from '@proanima/arkvory-infrastructure';
import type { LogLevel, PostgresJobLease } from '@proanima/arkvory-infrastructure';
import { capacityBytes, workerResources } from './runtime.js';
import { runMirrors } from './mirror-loop.js';
import { processJob, retireExhausted } from './completion.js';

let levelError: Error | undefined;
/** Stopped while another worker held the lock: a clean stop, not a failure. */
class StoppedOnStandby extends Error {}
function level(): LogLevel {
  try {
    return parseLogLevel(process.env['ARKVORY_LOG_LEVEL']);
  } catch (error) {
    // Reported as a startup failure below, once the logger exists.
    levelError = error instanceof Error ? error : new Error('Invalid ARKVORY_LOG_LEVEL');
    return 'info';
  }
}
// releases/<version>/apps/worker/dist/main.js -> releases/<version>/release.json
const identity = processIdentity(
  'worker',
  await readReleaseVersion(new URL('../../../release.json', import.meta.url)),
);
const diagnostics = new DiagnosticLogger(process.stdout, () => new Date().toISOString(), {
  level: level(),
  process: identity,
});
installCrashHandlers(diagnostics);
const stop = new AbortController();
let shutdownDeadline: ReturnType<typeof setTimeout> | undefined;
const stopWorker = (signal?: string) => {
  if (!stop.signal.aborted)
    diagnostics.write({
      level: 'info',
      component: 'worker',
      code: 'worker.stopping',
      ...(signal ? { signal } : {}),
    });
  stop.abort();
  shutdownDeadline ??= setTimeout(() => process.exit(1), 120000);
  shutdownDeadline.unref();
};
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    stopWorker(signal);
  });
try {
  if (levelError) throw levelError;
  startEventLoopWatchdog({
    seconds: watchdogSeconds(process.env['ARKVORY_WATCHDOG_SECONDS']),
    fields: identity,
    onError: (error) => {
      diagnostics.write({
        level: 'warning',
        component: 'worker',
        code: 'process.watchdog_failed',
        ...failureCause(error),
      });
    },
  });
  const keyFile = process.env['ARKVORY_KEYS_FILE'];
  if (!keyFile) throw new Error('ARKVORY_KEYS_FILE is required');
  const mirrors = await readMirrorSettings(process.env['ARKVORY_MIRRORS_FILE']);
  // Before the first request to a source: fetch reads the default authorities per connection.
  await trustMirrorCertificates(process.env['ARKVORY_MIRRORS_CA_FILE']);
  // Mirror copies create uploads here, so they need the installation's capacity limit.
  const acquired = await workerResources(
    mirrors.length > 0 ? capacityBytes(process.env['ARKVORY_CAPACITY_BYTES']) : 0,
    stop.signal,
    () => {
      diagnostics.write({ level: 'info', component: 'worker', code: 'worker.standby' });
    },
  );
  if (!acquired) throw new StoppedOnStandby();
  const { catalog, blobs } = acquired;
  let currentLease: PostgresJobLease | undefined;
  const recovery = setInterval(() => {
    if (stop.signal.aborted || (catalog.active && (!currentLease || currentLease.active))) return;
    process.exitCode = 1;
    diagnostics.write({ level: 'error', component: 'worker', code: 'worker.ownership_lost' });
    stopWorker();
  }, 1000);
  recovery.unref();
  const jobs = new PostgresJobs(catalog.pool);
  const dependencies = {
    jobs,
    identity: new PostgresIdentity(catalog.pool),
    services: new PostgresServices(catalog.pool),
    storage: new StorageService(catalog, blobs, {
      next: randomUUID,
      now: () => new Date().toISOString(),
    }),
    keyFile,
    ownerActive: () => catalog.active,
    stopped: stop.signal,
    diagnostics,
    now: () => performance.now(),
    leaseStarted: (lease: PostgresJobLease | undefined) => {
      currentLease = lease;
    },
  };
  diagnostics.write({ level: 'info', component: 'worker', code: 'worker.started' });
  const mirroring = runMirrors({
    catalog,
    blobs,
    dataDirectory: process.env['ARKVORY_DATA_DIR'] ?? '',
    mirrors,
    stop: stop.signal,
    diagnostics,
  });
  try {
    while (!stop.signal.aborted && catalog.active) {
      await retireExhausted(jobs, diagnostics);
      const job = await jobs.take();
      if (!job) {
        if (process.argv.includes('--once')) break;
        await delay(1000, undefined, { signal: stop.signal }).catch(() => undefined);
        continue;
      }
      await processJob(job, dependencies);
      if (process.argv.includes('--once')) break;
    }
    if (!catalog.active && !stop.signal.aborted)
      throw new ArkvoryError('unavailable', 'Worker ownership lost');
  } finally {
    // Mirror loops end on the same stop signal or lost ownership; the pool closes after them.
    if (!stop.signal.aborted) stopWorker();
    await mirroring;
    clearInterval(recovery);
    await catalog.close();
  }
  diagnostics.write({ level: 'info', component: 'worker', code: 'worker.stopped' });
} catch (error) {
  if (error instanceof StoppedOnStandby)
    diagnostics.write({ level: 'info', component: 'worker', code: 'worker.stopped' });
  else reportFailure(error);
}

function reportFailure(error: unknown) {
  // Constant identifiers and redacted validation text only; never URLs or credentials.
  diagnostics.write({
    level: 'error',
    component: 'worker',
    code: 'worker.unavailable',
    reason: startupReason(error),
    ...failureCause(error),
  });
  process.stderr.write(
    'Arkvory worker stopped with an error. Check configuration, database migration, storage access and the preceding worker.* line.\n',
  );
  process.exitCode = 1;
}

clearTimeout(shutdownDeadline);
// The logger stays open until exit so a late crash is still recorded by the crash handlers.
