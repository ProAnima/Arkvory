import type { ResourceFile } from '@proanima/arkvory-extension-api';
import type { ResourceCatalogDatabase } from './resource-catalog-db.js';
import {
  prepareRestore,
  restoreResources,
  type PreparedRestore,
} from './resource-catalog-rebuild.js';

interface Request {
  readonly file: PreparedRestore;
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
  readonly release: () => void;
}

/** At most eight outstanding restores per bound catalog, including the in-flight batch.
 * All results wait for the same durable commit; FIFO preserves canonical selection. */
export class ResourceRestoreQueue {
  private readonly queue: Request[] = [];
  private scheduled = false;
  constructor(private readonly database: ResourceCatalogDatabase) {}

  async restore(file: ResourceFile): Promise<void> {
    // Snapshot mutable module input before handing control back to the caller.
    const prepared = prepareRestore(file);
    const release = this.database.admit();
    return new Promise<void>((resolve, reject) => {
      this.queue.push({ file: prepared, resolve, reject, release });
      this.schedule();
    });
  }

  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    setImmediate(() => {
      void this.flush();
    });
  }

  private async flush(): Promise<void> {
    const batch = this.queue.splice(0);
    try {
      await restoreResources(
        this.database,
        batch.map((request) => request.file),
      );
      for (const request of batch) request.resolve();
    } catch (error) {
      for (const request of batch) request.reject(error);
    } finally {
      for (const request of batch) request.release();
      this.scheduled = false;
      if (this.queue.length) this.schedule();
    }
  }
}
