import type { DownloadStorage } from '@proanima/arkvory-sdk';
export { openDownloadWorkspace } from './download-workspace.js';
const segmentBytes = 8 * 1024 ** 2;

/** Bounded OPFS segments avoid rewriting a growing multi-GiB file at every checkpoint. */
export class BrowserDownloadStorage implements DownloadStorage {
  constructor(
    private readonly directory: FileSystemDirectoryHandle,
    private readonly id: string,
    public destination: FileSystemFileHandle | undefined,
  ) {}
  private folder() {
    return this.directory.getDirectoryHandle(this.id, { create: true });
  }
  async prefix(): Promise<Blob> {
    const folder = await this.folder();
    const names: string[] = [];
    for await (const [name, handle] of folder.entries()) {
      if (handle.kind !== 'file' || !/^part-[0-9]{4}$/.test(name))
        throw new Error('Invalid download staging');
      names.push(name);
      if (names.length > 640) throw new Error('Download staging limit exceeded');
    }
    names.sort();
    const parts: File[] = [];
    for (const [index, name] of names.entries()) {
      if (name !== this.partName(index)) throw new Error('Download staging gap');
      const file = await (await folder.getFileHandle(name)).getFile();
      if (file.size > segmentBytes || (index < names.length - 1 && file.size !== segmentBytes))
        throw new Error('Invalid download segment');
      parts.push(file);
    }
    // File-backed Blob parts keep bytes off the JS heap; prefix hashing remains streaming.
    return new Blob(parts);
  }
  private partName(index: number) {
    return `part-${String(index).padStart(4, '0')}`;
  }
  async append(offset: number): Promise<WritableStream<Uint8Array>> {
    const folder = await this.folder();
    let writer: FileSystemWritableFileStream | undefined;
    let position = offset;
    const open = async () => {
      if (position >= 5 * 1024 ** 3) throw new Error('Download staging limit exceeded');
      const file = await folder.getFileHandle(this.partName(Math.floor(position / segmentBytes)), {
        create: true,
      });
      writer = await file.createWritable({ keepExistingData: true });
      await writer.truncate(position % segmentBytes);
      await writer.seek(position % segmentBytes);
      return writer;
    };
    return new WritableStream<Uint8Array>({
      async write(chunk) {
        try {
          let consumed = 0;
          while (consumed < chunk.byteLength) {
            const current = writer ?? (await open());
            const size = Math.min(
              chunk.byteLength - consumed,
              segmentBytes - (position % segmentBytes),
            );
            await current.write(new Uint8Array(chunk.subarray(consumed, consumed + size)));
            position += size;
            consumed += size;
            if (position % segmentBytes === 0) {
              await current.close();
              writer = undefined;
            }
          }
        } catch (error) {
          await writer?.abort().catch(() => undefined);
          writer = undefined;
          throw error;
        }
      },
      async close() {
        try {
          if (writer) await writer.close();
        } catch (error) {
          await writer?.abort().catch(() => undefined);
          throw error;
        } finally {
          writer = undefined;
        }
      },
      async abort(reason) {
        if (writer) await writer.abort(reason);
      },
    });
  }
  async commit(): Promise<void> {
    if (!this.destination) throw new Error('Download destination required');
    const file = await this.prefix();
    const target = await this.destination.createWritable();
    await file.stream().pipeTo(target);
  }
  async discard(): Promise<void> {
    try {
      await this.directory.removeEntry(this.id, { recursive: true });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
    }
  }
}
