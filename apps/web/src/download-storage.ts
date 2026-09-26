import type { DownloadStorage } from '@proanima/arkvory-sdk';

/** A live tab holds a Web Lock. Only abandoned staging directories are reclaimed. */
export async function openDownloadWorkspace(): Promise<FileSystemDirectoryHandle> {
  const root = await (
    await navigator.storage.getDirectory()
  ).getDirectoryHandle('depot-download-staging-v1', { create: true });
  const name = `session-${crypto.randomUUID()}`;
  return new Promise((resolve, reject) => {
    void navigator.locks
      .request(`depot-download:${name}`, async () => {
        try {
          const directory = await root.getDirectoryHandle(name, { create: true });
          for await (const [entry, handle] of root.entries()) {
            if (
              entry === name ||
              handle.kind !== 'directory' ||
              !/^session-[a-f0-9-]{36}$/.test(entry)
            )
              continue;
            await navigator.locks.request(
              `depot-download:${entry}`,
              { ifAvailable: true },
              async (lock) => {
                if (lock) await root.removeEntry(entry, { recursive: true });
              },
            );
          }
          resolve(directory);
          // Browser releases the lock when this document is destroyed, including crashes.
          await new Promise<void>(() => undefined);
        } catch (error) {
          reject(error instanceof Error ? error : new Error('Download storage unavailable'));
        }
      })
      .catch(reject);
  });
}

/** One private OPFS file per job. Final picker destination is untouched until verified commit. */
export class BrowserDownloadStorage implements DownloadStorage {
  constructor(
    private readonly directory: FileSystemDirectoryHandle,
    private readonly id: string,
    private readonly destination: FileSystemFileHandle,
  ) {}
  async prefix(): Promise<Blob> {
    const file = await this.directory.getFileHandle(this.id, { create: true });
    return file.getFile();
  }
  async append(offset: number): Promise<WritableStream<Uint8Array>> {
    const file = await this.directory.getFileHandle(this.id);
    const writer = await file.createWritable({ keepExistingData: true });
    try {
      await writer.truncate(offset);
      await writer.seek(offset);
      return writer;
    } catch (error) {
      await writer.abort().catch(() => undefined);
      throw error;
    }
  }
  async commit(): Promise<void> {
    const file = await (await this.directory.getFileHandle(this.id)).getFile();
    const target = await this.destination.createWritable();
    await file.stream().pipeTo(target);
  }
  async discard(): Promise<void> {
    try {
      await this.directory.removeEntry(this.id);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
    }
  }
}
