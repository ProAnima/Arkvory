import {
  readStoragePolicySnapshot,
  readStorageUsage,
  readStoragePreview,
  readStorageRun,
  readStorageEvents,
  readCleanupSnapshot,
} from '@proanima/arkvory-contracts';
import type { StoragePolicyRequest, CleanupPolicyRequest } from '@proanima/arkvory-contracts';
import {
  readDeletionCandidate,
  readDeletionResult,
  readRetentionPreview,
  readRetentionResult,
} from '@proanima/arkvory-contracts';
import type { RetentionPreviewRequest, RetentionApplyRequest } from '@proanima/arkvory-contracts';
import type { HttpPort } from './http-transport.js';
import { repositoryPath } from './http-transport.js';

export class StorageApi {
  constructor(private readonly http: HttpPort) {}
  async cleanup(repository: string, signal?: AbortSignal) {
    return readCleanupSnapshot(
      await this.http.call(repositoryPath(repository, 'storage/cleanup'), 'GET', undefined, signal),
    );
  }
  async configureCleanup(
    repository: string,
    expectedRevision: number,
    policy: CleanupPolicyRequest,
    signal?: AbortSignal,
  ) {
    return readCleanupSnapshot(
      await this.http.call(
        repositoryPath(repository, 'storage/cleanup'),
        'PUT',
        { expectedRevision, policy },
        signal,
      ),
    );
  }
  async requestCleanup(repository: string, expectedRevision: number, signal?: AbortSignal) {
    return readCleanupSnapshot(
      await this.http.call(
        repositoryPath(repository, 'storage/cleanup/run'),
        'POST',
        { expectedRevision },
        signal,
      ),
    );
  }
  async inspectDeletion(repository: string, id: string, signal?: AbortSignal) {
    return readDeletionCandidate(
      await this.http.call(
        repositoryPath(repository, 'artifacts/' + encodeURIComponent(id) + '/deletion'),
        'GET',
        undefined,
        signal,
      ),
    );
  }
  async deleteArtifact(
    repository: string,
    id: string,
    expectedAnnotationRevision: number,
    signal?: AbortSignal,
  ) {
    return readDeletionResult(
      await this.http.call(
        repositoryPath(repository, 'artifacts/' + encodeURIComponent(id)),
        'DELETE',
        { expectedAnnotationRevision },
        signal,
      ),
    );
  }
  async storagePolicy(repository: string, signal?: AbortSignal) {
    return readStoragePolicySnapshot(
      await this.http.call(repositoryPath(repository, 'storage/policy'), 'GET', undefined, signal),
    );
  }
  async setStoragePolicy(
    repository: string,
    expectedRevision: number,
    policy: StoragePolicyRequest,
    signal?: AbortSignal,
  ) {
    return readStoragePolicySnapshot(
      await this.http.call(
        repositoryPath(repository, 'storage/policy'),
        'PUT',
        { expectedRevision, policy },
        signal,
      ),
    );
  }
  async storageUsage(repository: string, signal?: AbortSignal) {
    return readStorageUsage(
      await this.http.call(repositoryPath(repository, 'storage/usage'), 'GET', undefined, signal),
    );
  }
  async previewStoragePolicy(repository: string, signal?: AbortSignal) {
    return readStoragePreview(
      await this.http.call(repositoryPath(repository, 'storage/preview'), 'GET', undefined, signal),
    );
  }
  async runStoragePolicy(repository: string, expectedRevision: number, signal?: AbortSignal) {
    return readStorageRun(
      await this.http.call(
        repositoryPath(repository, 'storage/run'),
        'POST',
        { expectedRevision },
        signal,
      ),
    );
  }
  async storageEvents(
    repository: string,
    options: { after?: string; level?: 'info' | 'warning' | 'error' } = {},
    signal?: AbortSignal,
  ) {
    const query = new URLSearchParams();
    if (options.after !== undefined) query.set('after', options.after);
    if (options.level !== undefined) query.set('level', options.level);
    return readStorageEvents(
      await this.http.call(
        repositoryPath(repository, `storage/events?${query}`),
        'GET',
        undefined,
        signal,
      ),
    );
  }
  async previewRetention(repository: string, input: RetentionPreviewRequest, signal?: AbortSignal) {
    return readRetentionPreview(
      await this.http.call(repositoryPath(repository, 'retention/preview'), 'POST', input, signal),
    );
  }
  async applyRetention(repository: string, input: RetentionApplyRequest, signal?: AbortSignal) {
    return readRetentionResult(
      await this.http.call(repositoryPath(repository, 'retention/apply'), 'POST', input, signal),
    );
  }
}
