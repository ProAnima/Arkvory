import { readFile } from 'node:fs/promises';
import { ArkvoryError } from '@proanima/arkvory-domain';
import type { Principal } from '@proanima/arkvory-domain';
import type { ClaimedJob, StorageService } from '@proanima/arkvory-application';
import {
  classifyFailure,
  failureCause,
  parseKeys,
  PostgresJobLease,
} from '@proanima/arkvory-infrastructure';
import type {
  DiagnosticFields,
  DiagnosticLogger,
  FailureCause,
  PostgresIdentity,
  PostgresJobs,
  PostgresServices,
} from '@proanima/arkvory-infrastructure';

/** Job error codes drive bounded requeue; only an ArkvoryError keeps its deliberate code. */
export function jobErrorCode(error: unknown): string {
  if (error instanceof ArkvoryError) return error.code;
  switch (classifyFailure(error)) {
    case 'storage_full':
      return 'capacity_exceeded';
    case 'dependency_unavailable':
    case 'cancelled':
      return 'unavailable';
    case 'unexpected':
      return 'internal';
  }
}

export interface CompletionDependencies {
  readonly jobs: Pick<PostgresJobs, 'heartbeat' | 'finish'>;
  readonly identity: Pick<PostgresIdentity, 'principalForUser'>;
  readonly services: Pick<PostgresServices, 'principalForKey'>;
  readonly storage: Pick<StorageService, 'complete'>;
  readonly keyFile: string;
  readonly ownerActive: () => boolean;
  readonly stopped: AbortSignal;
  readonly diagnostics: Pick<DiagnosticLogger, 'write'>;
  /** Monotonic milliseconds. */
  readonly now: () => number;
  readonly leaseStarted: (lease: PostgresJobLease | undefined) => void;
}

/** Identifiers repeated on every line of one job so its lines join with the request and audit. */
export function jobFields(job: ClaimedJob): DiagnosticFields {
  return {
    jobId: job.id,
    uploadId: job.uploadId,
    repository: job.repository,
    generation: job.generation,
    attempts: job.attempts,
    ...(job.requestId ? { requestId: job.requestId } : {}),
  };
}

async function fileKeyPrincipal(keyFile: string, job: ClaimedJob) {
  const raw = await readFile(keyFile, 'utf8');
  if (raw.length > 1024 * 1024) throw new ArkvoryError('forbidden', 'Key configuration too large');
  const value: unknown = JSON.parse(raw);
  return parseKeys(value).find(
    (key) =>
      key.principal.id === job.owner &&
      key.principal.repositories.includes(job.repository) &&
      key.principal.permissions.includes('write'),
  )?.principal;
}

/** Re-resolves the owner's current authority; revocation since enqueue fails the job. */
async function jobPrincipal(job: ClaimedJob, d: CompletionDependencies): Promise<Principal> {
  let principal: Principal | null | undefined;
  if (job.owner.startsWith('service:')) {
    principal = job.credentialId ? await d.services.principalForKey(job.credentialId) : null;
    if (principal?.id !== job.owner) principal = null;
  } else if (job.owner.startsWith('user:'))
    principal = await d.identity.principalForUser(job.owner.slice(5));
  else principal = await fileKeyPrincipal(d.keyFile, job);
  if (!principal) throw new ArkvoryError('forbidden', 'Job authorization revoked');
  // The job carries the enqueuing request; completion work stays correlated with it.
  return job.requestId ? { ...principal, requestId: job.requestId } : principal;
}

/**
 * Completes one reserved job under its lease and records the outcome. The finish write is
 * fenced by generation: a lost lease reports completion.lease_lost and leaves the job to be
 * retaken; nothing here retries on its own.
 */
export async function processJob(job: ClaimedJob, d: CompletionDependencies): Promise<void> {
  const fields = jobFields(job);
  const started = d.now();
  d.diagnostics.write({
    level: 'debug',
    component: 'worker',
    code: 'completion.started',
    ...fields,
  });
  const lease = new PostgresJobLease(d.jobs, job.id, job.generation, d.ownerActive, (error) => {
    d.diagnostics.write({
      level: 'warning',
      component: 'worker',
      code: 'completion.heartbeat_failed',
      ...fields,
      ...(error instanceof ArkvoryError ? { errorCode: error.code } : failureCause(error)),
    });
  });
  let errorCode: string | null = null;
  let cause: FailureCause | undefined;
  try {
    await lease.start();
    d.leaseStarted(lease);
    const principal = await jobPrincipal(job, d);
    await d.storage.complete(principal, job.repository, job.uploadId, {
      throwIfAborted() {
        d.stopped.throwIfAborted();
        lease.check();
      },
    });
  } catch (error) {
    errorCode = jobErrorCode(error);
    if (!(error instanceof ArkvoryError)) cause = failureCause(error);
  }
  let recorded: boolean;
  d.leaseStarted(undefined);
  try {
    recorded = await lease.finish(errorCode);
  } finally {
    await lease.close();
  }
  const durationMs = Math.max(0, Math.round(d.now() - started));
  const outcome = !recorded
    ? 'completion.lease_lost'
    : errorCode
      ? 'completion.failed'
      : 'completion.completed';
  d.diagnostics.write({
    level: outcome === 'completion.completed' ? 'info' : 'error',
    component: 'worker',
    code: outcome,
    ...fields,
    durationMs,
    ...(errorCode ? { errorCode } : {}),
    ...cause,
  });
}

/** Jobs abandoned after their last attempt reach a final state and get one error line each. */
export async function retireExhausted(
  jobs: Pick<PostgresJobs, 'exhaust'>,
  diagnostics: Pick<DiagnosticLogger, 'write'>,
): Promise<void> {
  for (const job of await jobs.exhaust())
    diagnostics.write({
      level: 'error',
      component: 'worker',
      code: 'completion.attempts_exhausted',
      ...jobFields(job),
      errorCode: 'attempts_exhausted',
    });
}
