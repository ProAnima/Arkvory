import { ArkvoryError, BackupFailure, DEFAULT_STORAGE_BACKEND } from '@proanima/arkvory-domain';
import type { InventoryEntry } from '@proanima/arkvory-domain';
import type { BlobStore, Cancellation, RestoreStorage } from '@proanima/arkvory-application';
import type { StorageLifecycle } from './storage-lifecycle.js';

/**
 * An empty target storage filled through its regular write path (ADR 0054), only through its
 * port and lifecycle (ADR 0083, N9): each blob goes to the storage its inventory line names.
 */
export class LocalRestoreStorage implements RestoreStorage {
  constructor(private readonly target: BlobStore & StorageLifecycle) {}

  async requireEmpty(): Promise<void> {
    try {
      await this.target.requireEmpty();
    } catch (error) {
      if (error instanceof ArkvoryError && error.code === 'conflict')
        throw new BackupFailure('target_not_empty', 'Target storage directory is not empty');
      throw error;
    }
  }

  async prepare(): Promise<string> {
    await this.requireEmpty();
    await this.target.initialize();
    return this.target.identity();
  }

  async put(
    entry: InventoryEntry,
    source: AsyncIterable<Uint8Array>,
    cancellation: Cancellation,
  ): Promise<void> {
    const backend = entry.backend ?? DEFAULT_STORAGE_BACKEND;
    const descriptor = { name: 'restored', size: entry.size, sha256: entry.sha256 };
    await this.target.put(
      entry.id,
      { ...descriptor, labels: [], metadata: {} },
      source,
      cancellation,
      backend,
    );
    // Only the empty staging folder of this write is removed; published content stays.
    await this.target.collect?.(entry.id, false, cancellation, backend);
  }
}
