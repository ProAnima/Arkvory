import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { StorageService } from '@proanima/arkvory-application';
import { ArkvoryError } from '@proanima/arkvory-domain';
import {
  DiagnosticLogger,
  PostgresJobs,
  PostgresJobLease,
  PostgresIdentity,
  PostgresServices,
  parseKeys,
} from '@proanima/arkvory-infrastructure';
import { resources } from './runtime.js';

const diagnostics = new DiagnosticLogger(process.stdout, () => new Date().toISOString());
const stop = new AbortController();
let shutdownDeadline: ReturnType<typeof setTimeout> | undefined;
const stopWorker = () => {
  stop.abort();
  shutdownDeadline ??= setTimeout(() => process.exit(1), 120000);
  shutdownDeadline.unref();
};
for (const event of ['SIGINT', 'SIGTERM'] as const)
  process.once(event, () => {
    stopWorker();
  });
try {
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
  const identity = new PostgresIdentity(catalog.pool);
  const services = new PostgresServices(catalog.pool);
  const service = new StorageService(catalog, blobs, {
    next: randomUUID,
    now: () => new Date().toISOString(),
  });
  try {
    while (!stop.signal.aborted && catalog.active) {
      const job = await jobs.take();
      if (!job) {
        if (process.argv.includes('--once')) break;
        await delay(1000, undefined, { signal: stop.signal }).catch(() => undefined);
        continue;
      }
      const lease = new PostgresJobLease(jobs, job.id, job.generation, () => catalog.active);
      let errorCode: string | null = null;
      try {
        await lease.start();
        currentLease = lease;
        let principal;
        if (job.owner.startsWith('service:')) {
          principal = job.credentialId ? await services.principalForKey(job.credentialId) : null;
          if (principal?.id !== job.owner) principal = null;
        } else if (job.owner.startsWith('user:')) {
          principal = await identity.principalForUser(job.owner.slice(5));
        } else {
          const raw = await readFile(keyFile, 'utf8');
          if (raw.length > 1024 * 1024)
            throw new ArkvoryError('forbidden', 'Key configuration too large');
          const value: unknown = JSON.parse(raw);
          principal = parseKeys(value).find(
            (key) =>
              key.principal.id === job.owner &&
              key.principal.repositories.includes(job.repository) &&
              key.principal.permissions.includes('write'),
          )?.principal;
        }
        if (!principal) throw new ArkvoryError('forbidden', 'Job authorization revoked');
        await service.complete(principal, job.repository, job.uploadId, {
          throwIfAborted() {
            stop.signal.throwIfAborted();
            lease.check();
          },
        });
      } catch (error) {
        errorCode = error instanceof ArkvoryError ? error.code : 'unavailable';
      }
      let recorded = false;
      currentLease = undefined;
      try {
        recorded = await lease.finish(errorCode);
      } finally {
        await lease.close();
      }
      diagnostics.write({
        level: errorCode || !recorded ? 'error' : 'info',
        component: 'worker',
        code: !recorded ? 'completion.lease_lost' : (errorCode ?? 'completion.completed'),
        jobId: job.id,
        repository: job.repository,
      });
      if (process.argv.includes('--once')) break;
    }
    if (!catalog.active && !stop.signal.aborted)
      throw new ArkvoryError('unavailable', 'Worker ownership lost');
  } finally {
    clearInterval(recovery);
    await catalog.close();
  }
} catch {
  diagnostics.write({ level: 'error', component: 'worker', code: 'worker.unavailable' });
  process.exitCode = 1;
}

clearTimeout(shutdownDeadline);
diagnostics.close();
