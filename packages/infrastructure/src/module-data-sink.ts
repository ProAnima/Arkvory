import { link, mkdir, rename, rm, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ModuleServiceError } from '@proanima/arkvory-extension-api';
import type { FileSink } from '@proanima/arkvory-extension-api';
import type { ModuleDataAccounting } from './module-data-accounting.js';
import type { ModuleDataGuard } from './module-data-coordinator.js';
import { entryAt, requireInside } from './module-data-paths.js';
import { hasCode, syncDirectory } from './fs-durability.js';

export interface Place {
  readonly area: string;
  readonly folders: readonly string[];
  readonly path: string;
}

/** Bounded Windows sharing retries; caller rechecks ownership and removal on every attempt. */
export async function publishing(step: () => Promise<void>): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await step();
      return;
    } catch (error) {
      const held =
        process.platform === 'win32' &&
        (hasCode(error, 'EPERM') || hasCode(error, 'EACCES') || hasCode(error, 'EBUSY'));
      if (!held) throw error;
      if (attempt >= 5) throw new ModuleServiceError('unavailable', 'Data file is in use');
      await new Promise<void>((resolve) => setTimeout(resolve, 20 * 2 ** (attempt - 1)));
    }
  }
}

export async function makeFolders(
  place: Place,
  durable: boolean,
  guard: ModuleDataGuard,
): Promise<void> {
  await requireInside(place.area, place.folders);
  let parent = place.area;
  for (const segment of place.folders) {
    guard.check();
    const folder = join(parent, segment);
    try {
      await mkdir(folder, { mode: 0o700 });
      if (durable) await syncDirectory(parent);
    } catch (error) {
      if (!hasCode(error, 'EEXIST')) throw error;
    }
    parent = folder;
  }
}

/** The temporary file is a reservation shared by all hosts, including after a crash. */
export class ModuleDataSink implements FileSink {
  private done = false;
  private handleClosed = false;
  constructor(
    private readonly shared: ModuleDataAccounting,
    private readonly handle: FileHandle,
    private readonly temporary: string,
    private readonly target: Place,
    private readonly options: { readonly durable: boolean; readonly exclusive: boolean },
    private readonly requireRemoval?: () => void,
  ) {}

  private check(): void {
    if (this.done) throw new ModuleServiceError('conflict', 'File is closed');
  }

  async write(chunk: Uint8Array): Promise<void> {
    await this.shared.run(async (guard) => {
      this.check();
      await this.shared.ledger.track(this.temporary, true);
      try {
        await this.shared.quota(this.target.path, chunk.byteLength, 0);
        await this.shared.room(chunk.byteLength);
        let offset = 0;
        while (offset < chunk.byteLength) {
          guard.check();
          const result = await this.handle.write(chunk, offset, chunk.byteLength - offset);
          if (result.bytesWritten <= 0) throw new ModuleServiceError('unavailable');
          offset += result.bytesWritten;
        }
      } catch (error) {
        await this.discard(guard);
        throw error;
      }
    });
  }

  async close(): Promise<void> {
    await this.shared.run(async (guard) => {
      this.check();
      await this.shared.ledger.track(this.temporary, true);
      try {
        if (this.options.durable) await this.handle.sync();
        await this.closeHandle();
        await this.shared.ledger.track(this.target.path);
        await makeFolders(this.target, this.options.durable, guard);
        await this.shared.quota(this.target.path, 0, 0);
        const before = await entryAt(this.target.path);
        if (before && (this.options.exclusive || !before.isFile()))
          throw new ModuleServiceError('conflict', 'File exists');
        await publishing(async () => {
          guard.check();
          if (before) {
            this.requireRemoval?.();
            await rename(this.temporary, this.target.path);
          } else {
            // Atomic no-replace even for non-exclusive creates of previously absent names.
            try {
              await link(this.temporary, this.target.path);
            } catch (error) {
              if (hasCode(error, 'EEXIST')) throw new ModuleServiceError('conflict', 'File exists');
              throw error;
            }
            guard.check();
            await unlink(this.temporary);
          }
        });
        this.finish();
        if (this.options.durable) await syncDirectory(dirname(this.target.path));
      } catch (error) {
        await this.discard(guard);
        throw error;
      }
    });
  }

  private finish(): void {
    this.done = true;
    this.shared.sinks.delete(this);
  }

  private async closeHandle(): Promise<void> {
    if (this.handleClosed) return;
    await this.handle.close();
    this.handleClosed = true;
  }

  private async discard(guard: ModuleDataGuard): Promise<void> {
    await this.shared.ledger.track(this.temporary, true);
    await this.closeHandle();
    guard.check();
    await rm(this.temporary, { force: true });
    this.finish();
  }

  async abort(): Promise<void> {
    if (this.done) return;
    try {
      await this.shared.run(async (guard) => {
        if (!this.done) await this.discard(guard);
      }, true);
    } catch (error) {
      // Always release the OS handle, but never unlink after lost admission. The next owner
      // reclaims the charged temporary file only after acquiring this owner's session lock.
      await this.closeHandle();
      this.finish();
      throw error;
    }
  }
}
