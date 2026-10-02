import { mkdir, readdir } from 'node:fs/promises';
import { BackupFailure } from '@proanima/arkvory-domain';
import type { InventoryEntry } from '@proanima/arkvory-domain';
import type { Cancellation, RestoreStorage } from '@proanima/arkvory-application';
import { LocalBlobStore } from './local-blobs.js';
import { hasCode } from './fs-durability.js';

/** Empty target storage directory filled through the regular LocalBlobStore write path. */
export class LocalRestoreStorage implements RestoreStorage {
  private readonly blobs: LocalBlobStore;
  constructor(
    private readonly root: string,
    reserveBytes: number,
  ) {
    this.blobs = new LocalBlobStore(root, reserveBytes);
  }

  async requireEmpty(): Promise<void> {
    try {
      if ((await readdir(this.blobs.root)).length)
        throw new BackupFailure('target_not_empty', 'Target storage directory is not empty');
    } catch (error) {
      if (!hasCode(error, 'ENOENT')) throw error;
    }
  }

  async prepare(): Promise<string> {
    await this.requireEmpty();
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await this.blobs.initialize();
    return this.blobs.identity();
  }

  async put(
    entry: InventoryEntry,
    source: AsyncIterable<Uint8Array>,
    cancellation: Cancellation,
  ): Promise<void> {
    const descriptor = { name: 'restored', size: entry.size, sha256: entry.sha256 };
    await this.blobs.put(
      entry.id,
      { ...descriptor, labels: [], metadata: {} },
      source,
      cancellation,
    );
    // Only the empty staging folder of this write is removed; published content stays.
    await this.blobs.collect(entry.id, false, cancellation);
  }
}
