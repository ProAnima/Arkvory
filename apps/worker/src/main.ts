import './confine.js';
import { randomUUID } from 'node:crypto';
import { getCACertificates } from 'node:tls';
import { setTimeout as delay } from 'node:timers/promises';
import { StorageService } from '@proanima/arkvory-application';
import { ArkvoryError } from '@proanima/arkvory-domain';
import {
  DiagnosticLogger,
  databasePlaintextExposed,
  failureCause,
  installCrashHandlers,
  parseLogLevel,
  processIdentity,
  readReleaseVersion,
  startupReason,
  PostgresJobs,
  PostgresIdentity,
  PostgresModulePlan,
  PostgresServices,
  installedModulesFrom,
  loadInstallation,
  readMirrorSettings,
  readModuleSelections,
  readWebhookCertificates,
  readWebhookSettings,
  parseAllowedNetworks,
  createEgressPolicy,
  startEventLoopWatchdog,
  trustMirrorCertificates,
  watchdogSeconds,
} from '@proanima/arkvory-infrastructure';
import type { LogLevel, PostgresJobLease } from '@proanima/arkvory-infrastructure';
import { capacityBytes, standbyRetryMs, workerResources } from './runtime.js';
import { runMirrors } from './mirror-loop.js';
import { runWebhooks } from './webhook-loop.js';
import { readEventRetention, runEventSequencer } from './event-loop.js';
import { processJob, retireExhausted } from './completion.js';
import { acquireWithPlan, watchModulePlan } from './module-plan.js';
import { watchWorkerStorage } from './storage-watch.js';

let levelError: Error | undefined;
/** Stopped before taking work, as standby or waiting for the module plan: a clean stop. */
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
  // Receivers trust what this process trusted before the mirror authorities were added.
  const receiverAuthorities = getCACertificates('default');
  // Before the first request to a source: fetch reads the default authorities per connection.
  await trustMirrorCertificates(process.env['ARKVORY_MIRRORS_CA_FILE']);
  // Webhooks (ADR 0069): invalid files stop startup here, not at the first delivery.
  const webhooks = await readWebhookSettings(process.env['ARKVORY_WEBHOOKS_FILE']);
  const egress = createEgressPolicy(
    parseAllowedNetworks(process.env['ARKVORY_WEBHOOKS_ALLOW_PRIVATE']),
  );
  const certificates = await readWebhookCertificates(
    process.env['ARKVORY_WEBHOOKS_CA_FILE'],
    receiverAuthorities,
  );
  // ADR 0080: retention of the event outbox, checked before the worker takes its lock.
  const eventRetention = readEventRetention(process.env);
  // ADR 0079: the installation's module plan, refused before the worker takes its lock. The
  // installed signed modules are verified and planned like the writer's; none runs here (X4).
  const { compatibilityFingerprint } = (
    await loadInstallation({
      role: 'worker',
      coreVersion: identity.version,
      selections: await readModuleSelections(process.env['ARKVORY_MODULES_FILE']),
      installed: installedModulesFrom(process.env),
      now: Date.now(),
    })
  ).plan;
  // Mirror copies create uploads here, so they need the installation's capacity limit.
  const capacity = mirrors.length > 0 ? capacityBytes(process.env['ARKVORY_CAPACITY_BYTES']) : 0;
  // A worker with another plan than the writer's gives its lock back while it waits.
  const acquired = await acquireWithPlan(
    {
      acquire: () =>
        workerResources(
          capacity,
          stop.signal,
          () => {
            diagnostics.write({ level: 'info', component: 'worker', code: 'worker.standby' });
          },
          standbyRetryMs,
          // Every mirror holds a write lock for a whole part copy: one connection each (ADR 0073).
          2 + Math.min(mirrors.length, 16),
        ),
      recorded: (resources) => new PostgresModulePlan(resources.catalog.pool),
      release: (resources) => resources.catalog.close(),
      onMismatch: () => {
        diagnostics.write({
          level: 'warning',
          component: 'worker',
          code: 'worker.module_plan_mismatch',
        });
      },
    },
    compatibilityFingerprint,
    stop.signal,
  );
  if (!acquired) throw new StoppedOnStandby();
  const { catalog, blobs, staging, placement } = acquired;
  const unwatchStorage = watchWorkerStorage(blobs, catalog, diagnostics);
  const recordedPlan = new PostgresModulePlan(catalog.pool);
  const unwatchPlan = watchModulePlan(recordedPlan, compatibilityFingerprint, () => {
    process.exitCode = 1;
    diagnostics.write({ level: 'error', component: 'worker', code: 'worker.module_plan_changed' });
    stopWorker();
  });
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
    storage: new StorageService(
      catalog,
      blobs,
      { next: randomUUID, now: () => new Date().toISOString() },
      // Large uploads complete here; a storage may assemble them from its parts (ADR 0083, N1).
      { placement, staged: blobs },
    ),
    keyFile,
    ownerActive: () => catalog.active,
    stopped: stop.signal,
    diagnostics,
    now: () => performance.now(),
    leaseStarted: (lease: PostgresJobLease | undefined) => {
      currentLease = lease;
    },
  };
  if (databasePlaintextExposed(process.env['ARKVORY_DATABASE_URL'] ?? ''))
    diagnostics.write({
      level: 'warning',
      component: 'worker',
      code: 'database.plaintext_exposed',
    });
  diagnostics.write({ level: 'info', component: 'worker', code: 'worker.started' });
  const mirroring = runMirrors({
    catalog,
    blobs,
    staging,
    placement,
    mirrors,
    stop: stop.signal,
    diagnostics,
  }).catch((error: unknown) => {
    // Awaited only at shutdown: a rejection left until then would end the process early.
    diagnostics.write({
      level: 'error',
      component: 'mirror',
      code: 'mirror.step_failed',
      errorCode: 'mirror_failed',
      ...failureCause(error),
    });
  });
  const delivering = runWebhooks({
    catalog,
    webhooks,
    egress,
    certificates,
    stop: stop.signal,
    diagnostics,
  });
  const sequencing = runEventSequencer({
    catalog,
    retention: eventRetention,
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
    await delivering;
    await sequencing;
    clearInterval(recovery);
    unwatchPlan();
    unwatchStorage();
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
