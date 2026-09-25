import {
  authorizeAction,
  parseStoragePolicyUpdate,
  annotationRevision,
  retentionObject,
} from '@proanima/depot-domain';
import type {
  Principal,
  MutationAccess,
  StoragePolicy,
  CapacityState,
} from '@proanima/depot-domain';
import type { DeletionCandidate, DeletionResult } from './retention.js';

export interface StoragePolicySnapshot {
  revision: number;
  policy: StoragePolicy;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastDeleted: number;
  lastError: string | null;
}
export interface StorageUsage {
  publishedBytes: string;
  pendingBytes: string;
  retiredBytes: string;
  reservedBytes: string;
  quotaBytes: string | null;
  state: CapacityState;
}
export interface StorageEvent {
  sequence: string;
  occurredAt: string;
  level: 'info' | 'warning' | 'error';
  code: string;
  details: Readonly<Record<string, string | number>>;
}
export interface StoragePolicyStore {
  get(repository: string): Promise<StoragePolicySnapshot>;
  save(
    access: MutationAccess,
    expectedRevision: number,
    policy: StoragePolicy,
  ): Promise<StoragePolicySnapshot>;
  usage(repository: string): Promise<StorageUsage>;
  preview(
    repository: string,
  ): Promise<{ revision: number; items: readonly DeletionCandidate[]; hasMore: boolean }>;
  run(
    access: MutationAccess,
    expectedRevision: number,
  ): Promise<{ items: readonly DeletionResult[] }>;
  events(
    repository: string,
    after: string,
    level?: StorageEvent['level'],
  ): Promise<{ items: readonly StorageEvent[]; next: string | null }>;
}
export class RepositoryStorage {
  constructor(private readonly store: StoragePolicyStore) {}
  get(p: Principal, repository: string) {
    authorizeAction(p, repository, 'storage.read', null);
    return this.store.get(repository);
  }
  usage(p: Principal, repository: string) {
    authorizeAction(p, repository, 'storage.read', null);
    return this.store.usage(repository);
  }
  save(p: Principal, repository: string, value: unknown) {
    authorizeAction(p, repository, 'storage.manage', null);
    const { expectedRevision, policy } = parseStoragePolicyUpdate(value);
    if (policy.enabled) authorizeAction(p, repository, 'artifact.delete', null);
    return this.store.save(
      {
        principal: p,
        repository,
        actions: policy.enabled ? ['storage.manage', 'artifact.delete'] : ['storage.manage'],
      },
      expectedRevision,
      policy,
    );
  }
  preview(p: Principal, repository: string) {
    authorizeAction(p, repository, 'artifact.delete', null);
    return this.store.preview(repository);
  }
  run(p: Principal, repository: string, value: unknown) {
    authorizeAction(p, repository, 'storage.manage', null);
    authorizeAction(p, repository, 'artifact.delete', null);
    const r = retentionObject(value, ['expectedRevision']);
    return this.store.run(
      { principal: p, repository, actions: ['storage.manage', 'artifact.delete'] },
      annotationRevision(r['expectedRevision']),
    );
  }
}
