import { record, text } from '@proanima/arkvory-contracts';

export interface DownloadReceipt {
  readonly id: string;
  readonly repository: string;
  readonly artifactId: string;
  readonly name: string;
  readonly server: string;
  readonly owner: string;
  readonly createdAt: number;
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

/** Small per-job atomic records. Credentials and destination handles never enter persistence. */
export class DownloadJournal {
  constructor(private readonly directory: FileSystemDirectoryHandle) {}
  async save(receipt: DownloadReceipt) {
    const file = await this.directory.getFileHandle(`${receipt.id}.json`, { create: true });
    const writer = await file.createWritable();
    try {
      await writer.write(JSON.stringify({ ...receipt, format: 1 }));
      await writer.close();
    } catch (error) {
      await writer.abort().catch(() => undefined);
      throw error;
    }
  }
  async remove(id: string) {
    try {
      await this.directory.removeEntry(`${id}.json`);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
    }
  }
  async read(server: string, owner: string): Promise<DownloadReceipt[]> {
    const result: DownloadReceipt[] = [];
    for await (const [name, handle] of this.directory.entries()) {
      if (handle.kind !== 'file' || !name.endsWith('.json') || !uuid.test(name.slice(0, -5)))
        continue;
      const file = await (await this.directory.getFileHandle(name)).getFile();
      if (file.size > 16384) throw new Error('Invalid download receipt');
      const row = record(JSON.parse(await file.text()));
      if (row['format'] !== 1) throw new Error('Unknown download receipt');
      if (row['server'] !== server || row['owner'] !== owner) continue;
      if (
        typeof row['createdAt'] !== 'number' ||
        !Number.isSafeInteger(row['createdAt']) ||
        row['createdAt'] < 0
      )
        throw new Error('Invalid download receipt');
      const item = {
        id: text(row['id']),
        repository: text(row['repository']),
        artifactId: text(row['artifactId']),
        name: text(row['name']),
        server,
        owner,
        createdAt: row['createdAt'],
      };
      if (
        item.id + '.json' !== name ||
        !uuid.test(item.artifactId) ||
        item.repository.length > 128 ||
        item.name.length > 1024
      )
        throw new Error('Invalid download receipt');
      result.push(item);
      if (result.length > 64) throw new Error('Download receipt limit exceeded');
    }
    return result.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  }
}
