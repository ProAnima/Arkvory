import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { StorageService } from '@proanima/depot-application';
import { DepotError } from '@proanima/depot-domain';
import {
  DiagnosticLogger,
  PostgresJobs,
  PostgresIdentity,
  PostgresServices,
  parseKeys,
} from '@proanima/depot-infrastructure';
import { resources } from './runtime.js';

const diagnostics = new DiagnosticLogger(process.stdout, () => new Date().toISOString());
const stop = new AbortController();
for (const event of ['SIGINT', 'SIGTERM'] as const)
  process.once(event, () => {
    stop.abort();
  });
try {
  const keyFile = process.env['DEPOT_KEYS_FILE'];
  if (!keyFile) throw new Error('DEPOT_KEYS_FILE is required');
  const { catalog, blobs } = await resources('worker');
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
      const state = { lost: false };
      let heartbeat: Promise<void> = Promise.resolve();
      const timer = setInterval(() => {
        heartbeat = heartbeat.then(async () => {
          try {
            if (!(await jobs.heartbeat(job.id, job.generation))) state.lost = true;
          } catch {
            state.lost = true;
          }
        });
      }, 10000);
      let errorCode: string | null = null;
      try {
        let principal;
        if (job.owner.startsWith('service:')) {
          principal = job.credentialId ? await services.principalForKey(job.credentialId) : null;
          if (principal?.id !== job.owner) principal = null;
        } else if (job.owner.startsWith('user:')) {
          principal = await identity.principalForUser(job.owner.slice(5));
        } else {
          const raw = await readFile(keyFile, 'utf8');
          if (raw.length > 1024 * 1024)
            throw new DepotError('forbidden', 'Key configuration too large');
          const value: unknown = JSON.parse(raw);
          principal = parseKeys(value).find(
            (key) =>
              key.principal.id === job.owner &&
              key.principal.repositories.includes(job.repository) &&
              key.principal.permissions.includes('write'),
          )?.principal;
        }
        if (!principal) throw new DepotError('forbidden', 'Job authorization revoked');
        await service.complete(principal, job.repository, job.uploadId, {
          throwIfAborted() {
            stop.signal.throwIfAborted();
            if (state.lost || !catalog.active)
              throw new DepotError('unavailable', 'Worker lease lost');
          },
        });
      } catch (error) {
        errorCode = error instanceof DepotError ? error.code : 'unavailable';
      } finally {
        clearInterval(timer);
        await heartbeat;
      }
      if (!state.lost) await jobs.finish(job.id, job.generation, errorCode);
      diagnostics.write({
        level: errorCode || state.lost ? 'error' : 'info',
        component: 'worker',
        code: state.lost ? 'completion.lease_lost' : (errorCode ?? 'completion.completed'),
        jobId: job.id,
        repository: job.repository,
      });
      if (process.argv.includes('--once')) break;
    }
  } finally {
    await catalog.close();
  }
} catch {
  diagnostics.write({ level: 'error', component: 'worker', code: 'worker.unavailable' });
  process.exitCode = 1;
}

diagnostics.close();
