import { ArkvoryError, BackupFailure, DEFAULT_STORAGE_BACKEND } from '@proanima/arkvory-domain';
import type { InventoryEntry } from '@proanima/arkvory-domain';
import type { Cancellation, RestoreStorage } from '@proanima/arkvory-application';
import type { StorageBackends } from './storage-backends.js';

/**
 * Empty target storages filled through their regular write path (ADR 0054), only through the
 * port and the lifecycle of each (ADR 0083, N9): each blob goes to the storage its inventory
 * line names, so the restored upload rows find their content where they say it is. Every
 * storage of the target must be empty, and every storage named by the point must be part of
 * the target (`supports`): the restore is refused before the first byte otherwise.
 */
export class LocalRestoreStorage implements RestoreStorage {
  constructor(private readonly target: StorageBackends) {}

  /** A storage of the target that will take writes once prepared. */
  supports(backend: string): boolean {
    const state = this.target.state(backend);
    return state !== 'not_loaded' && state !== 'disabled' && state !== 'read_only';
  }

  async requireEmpty(): Promise<void> {
    for (const instance of [this.target.core, ...this.target.extras()])
      try {
        await instance.lifecycle.requireEmpty();
      } catch (error) {
        if (error instanceof ArkvoryError && error.code === 'conflict')
          throw new BackupFailure('target_not_empty', 'Target storage directory is not empty');
        throw error;
      }
  }

  async prepare(): Promise<string> {
    await this.requireEmpty();
    await this.target.core.lifecycle.initialize();
    // Each volume gets its new identity file here; the restored installation records it at
    // the first start of its writer.
    for (const instance of this.target.extras()) {
      await instance.lifecycle.initialize();
      this.target.mark(instance.id, null, await instance.lifecycle.identity());
    }
    return this.target.core.lifecycle.identity();
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
    await this.target.collect(entry.id, false, cancellation, backend);
  }
}
