import { authorize, DepotError, requireId } from '@proanima/depot-domain';
import type { Principal } from '@proanima/depot-domain';

export interface CleanupRecord {
  id: string;
  repository: string;
  status: 'pending' | 'available' | 'cancelled';
  expiresAt: string;
  cancelledAt: string | null;
}
export interface CleanupCatalog {
  page(after: string | undefined, limit: number): Promise<readonly CleanupRecord[]>;
  expire(id: string, now: string): Promise<void>;
  reclaimed(id: string): Promise<void>;
}
export interface CleanupBlobs {
  collect(id: string, removeContent: boolean): Promise<void>;
}

export class GarbageCollector {
  constructor(
    private readonly catalog: CleanupCatalog,
    private readonly blobs: CleanupBlobs,
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
      throw new DepotError('invalid_input', 'Invalid cleanup policy');
    let after: string | undefined;
    let visited = 0;
    let collected = 0;
    for (;;) {
      const rows = await this.catalog.page(after, 100);
      if (rows.length === 0) break;
      for (const row of rows) {
        visited++;
        after = row.id;
        if (row.status === 'pending' && Date.parse(row.expiresAt) <= Date.parse(now)) {
          await this.catalog.expire(row.id, now);
          continue;
        }
        if (row.status === 'available') {
          await this.blobs.collect(row.id, false);
          continue;
        }
        if (
          row.status === 'cancelled' &&
          row.cancelledAt !== null &&
          Date.parse(row.cancelledAt) + graceMilliseconds <= Date.parse(now)
        ) {
          await this.blobs.collect(row.id, true);
          await this.catalog.reclaimed(row.id);
          collected++;
        }
      }
    }
    return { visited, collected };
  }
}

export interface CompletionJob {
  id: string;
  repository: string;
  uploadId: string;
  owner: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  generation: number;
  attempts: number;
  errorCode: string | null;
}
export interface JobStore {
  enqueue(repository: string, uploadId: string, owner: string, id: string): Promise<CompletionJob>;
  get(id: string): Promise<CompletionJob>;
  take(): Promise<CompletionJob | null>;
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
    authorize(principal, repository, 'write');
    requireId(uploadId);
    return this.jobs.enqueue(repository, uploadId, principal.id, this.next());
  }
  async get(principal: Principal, id: string): Promise<CompletionJob> {
    const job = await this.jobs.get(requireId(id));
    authorize(principal, job.repository, 'write');
    if (job.owner !== principal.id) throw new DepotError('not_found', 'Job not found');
    return job;
  }
}
