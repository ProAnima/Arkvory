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
} from '@proanima/arkvory-infrastructure';
import type { LogLevel, PostgresJobLease } from '@proanima/arkvory-infrastructure';
import { resources } from './runtime.js';
import { processJob, retireExhausted } from './completion.js';

let levelError: Error | undefined;
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
const diagnostics = new DiagnosticLogger(process.stdout, () => new Date().toISOString(), {
  level: level(),
  process: processIdentity(
    'worker',
    await readReleaseVersion(new URL('../../../release.json', import.meta.url)),
  ),
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
  const keyFile = process.env['ARKVORY_KEYS_FILE'];
  if (!keyFile) throw new Error('ARKVORY_KEYS_FILE is required');
  const { catalog, blobs } = await resources('worker');
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
    clearInterval(recovery);
    await catalog.close();
  }
  diagnostics.write({ level: 'info', component: 'worker', code: 'worker.stopped' });
} catch (error) {
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
