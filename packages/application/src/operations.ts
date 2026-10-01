import { authorizeAction, ArkvoryError, requireId } from '@proanima/arkvory-domain';
import type { Principal, MutationAccess } from '@proanima/arkvory-domain';
import type { Cancellation } from './ports.js';

export interface CleanupRecord {
  id: string;
  repository: string;
  status: 'pending' | 'available' | 'cancelled';
  expiresAt: string;
  cancelledAt: string | null;
}
export interface CleanupCatalog {
  /** Hold upload ownership and, for blob removal, the exclusive content guard during action. */
  exclusive<T>(
    id: string,
    removeContent: boolean,
    action: (cancellation: Cancellation) => Promise<T>,
  ): Promise<T>;
  page(after: string | undefined, limit: number): Promise<readonly CleanupRecord[]>;
  expire(id: string, now: string): Promise<void>;
  reclaimed(id: string): Promise<void>;
}
export interface CleanupBlobs {
  /** Check ownership between filesystem operations; an already submitted syscall cannot be revoked. */
  collect(id: string, removeContent: boolean, cancellation: Cancellation): Promise<void>;
}

export class GarbageCollector {
  constructor(
    private readonly catalog: CleanupCatalog,
    private readonly blobs: CleanupBlobs,
    private readonly cancellation: Cancellation,
  ) {}
  async run(
    now: string,
    graceMilliseconds = 86400000,
  ): Promise<{ visited: number; collected: number }> {
    if (
      !Number.isFinite(Date.parse(now)) ||
      !Number.isSafeInteger(graceMilliseconds) ||
      graceMilliseconds < 0
    )
      throw new ArkvoryError('invalid_input', 'Invalid cleanup policy');
    let after: string | undefined;
    let visited = 0;
    let collected = 0;
    for (;;) {
      this.cancellation.throwIfAborted();
      const rows = await this.catalog.page(after, 100);
      this.cancellation.throwIfAborted();
      if (rows.length === 0) break;
      for (const row of rows) {
        visited++;
        after = row.id;
        if (await this.collect(row, now, graceMilliseconds)) collected++;
      }
    }
    return { visited, collected };
  }
  private async collect(row: CleanupRecord, now: string, graceMilliseconds: number) {
    this.cancellation.throwIfAborted();
    if (row.status === 'pending' && Date.parse(row.expiresAt) > Date.parse(now)) return false;
    if (
      row.status === 'cancelled' &&
      (row.cancelledAt === null ||
        Date.parse(row.cancelledAt) + graceMilliseconds > Date.parse(now))
    )
      return false;
    return this.catalog.exclusive(row.id, row.status === 'cancelled', async (ownership) => {
      const cancellation = {
        throwIfAborted: () => {
          this.cancellation.throwIfAborted();
          ownership.throwIfAborted();
        },
      };
      cancellation.throwIfAborted();
      if (row.status === 'pending') {
        await this.catalog.expire(row.id, now);
        cancellation.throwIfAborted();
        return false;
      }
      await this.blobs.collect(row.id, row.status === 'cancelled', cancellation);
      cancellation.throwIfAborted();
      if (row.status === 'available') return false;
      await this.catalog.reclaimed(row.id);
      cancellation.throwIfAborted();
      return true;
    });
  }
}

export interface CompletionJob {
  credentialId?: string;
  id: string;
  repository: string;
  uploadId: string;
  owner: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  generation: number;
  attempts: number;
  errorCode: string | null;
}
/** A job reserved by a worker, with the request that last queued it (NULL before migration 24). */
export interface ClaimedJob extends CompletionJob {
  readonly requestId: string | null;
}
export interface JobStore {
  /** Records access.principal.requestId with the job; a requeue replaces it. */
  enqueue(
    repository: string,
    uploadId: string,
    owner: string,
    id: string,
    access?: MutationAccess,
  ): Promise<CompletionJob>;
  get(id: string): Promise<CompletionJob>;
  /** Fails abandoned jobs whose attempts are spent; each row is returned to exactly one caller. */
  exhaust(): Promise<readonly ClaimedJob[]>;
  /** Never selects exhausted jobs; a worker calls exhaust() first so they reach a final state. */
  take(): Promise<ClaimedJob | null>;
  heartbeat(id: string, generation: number): Promise<boolean>;
  finish(id: string, generation: number, errorCode: string | null): Promise<boolean>;
}

export class CompletionQueue {
  constructor(
    private readonly jobs: JobStore,
    private readonly next: () => string,
  ) {}
  async enqueue(
    principal: Principal,
    repository: string,
    uploadId: string,
  ): Promise<CompletionJob> {
    authorizeAction(principal, repository, 'upload.complete', ['write']);
    requireId(uploadId);
    return this.jobs.enqueue(repository, uploadId, principal.id, this.next(), {
      principal,
      repository,
      actions: ['upload.complete'],
    });
  }
  async get(principal: Principal, id: string): Promise<CompletionJob> {
    const job = await this.jobs.get(requireId(id));
    authorizeAction(principal, job.repository, 'job.read', ['write']);
    if (job.owner !== principal.id) throw new ArkvoryError('not_found', 'Job not found');
    return job;
  }
}
