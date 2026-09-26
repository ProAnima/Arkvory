import {
  authorizeAction,
  annotationRevision,
  parseCleanupPolicy,
  retentionObject,
} from '@proanima/arkvory-domain';
import type { CleanupPolicy, MutationAccess, Principal } from '@proanima/arkvory-domain';

export interface CleanupSnapshot {
  revision: number;
  policy: CleanupPolicy;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastCollected: number;
  lastDeferred: number;
  lastFailed: number;
  lastReclaimedBytes: string;
  lastError: string | null;
}
export interface CleanupSettings {
  get(repository: string): Promise<CleanupSnapshot>;
  save(access: MutationAccess, revision: number, policy: CleanupPolicy): Promise<CleanupSnapshot>;
  request(access: MutationAccess, revision: number): Promise<CleanupSnapshot>;
}
export class RepositoryCleanup {
  constructor(private readonly store: CleanupSettings) {}
  get(principal: Principal, repository: string) {
    authorizeAction(principal, repository, 'storage.read', null);
    return this.store.get(repository);
  }
  save(principal: Principal, repository: string, value: unknown) {
    authorizeAction(principal, repository, 'storage.manage', null);
    const r = retentionObject(value, ['expectedRevision', 'policy']);
    return this.store.save(
      { principal, repository, actions: ['storage.manage'] },
      annotationRevision(r['expectedRevision']),
      parseCleanupPolicy(r['policy']),
    );
  }
  request(principal: Principal, repository: string, value: unknown) {
    authorizeAction(principal, repository, 'storage.manage', null);
    const r = retentionObject(value, ['expectedRevision']);
    return this.store.request(
      { principal, repository, actions: ['storage.manage'] },
      annotationRevision(r['expectedRevision']),
    );
  }
}
