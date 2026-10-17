import { fromRandomAccessReader } from 'yauzl';
import type { Entry, ZipFile } from 'yauzl';
import { ArkvoryError, parseManifest, requireAssetPath } from '@proanima/arkvory-domain';
import type { PackageManifest } from '@proanima/arkvory-domain';
import type { BlobStore, ManifestReader, ManifestSource } from '@proanima/arkvory-application';
import type { PostgresContentPins } from './content-pins.js';
import { BlobRangeReader } from './blob-range-reader.js';

const zipOptions = {
  lazyEntries: true,
  autoClose: true,
  strictFileNames: true,
  validateEntrySizes: true,
} as const;

/**
 * The root `upack.json` of a published archive, read through `BlobStore.read(range)` under a
 * shared content pin (ADR 0035): the central directory and the manifest entry only, never the
 * whole blob (ADR 0083, N9). A storage failure keeps its own code; only the archive's own
 * defects are `invalid_input`.
 */
export class ZipManifestReader implements ManifestReader {
  constructor(
    private readonly blobs: BlobStore,
    private readonly pins?: PostgresContentPins,
  ) {}
  async inspect(source: ManifestSource): Promise<PackageManifest> {
    const pin = await this.pins?.acquire(source.id);
    try {
      const reader = new BlobRangeReader(this.blobs, source, { check: () => pin?.check() });
      const result = await this.inspectArchive(reader, source.size);
      pin?.check();
      return result;
    } finally {
      await pin?.release();
    }
  }
  private async inspectArchive(reader: BlobRangeReader, size: number): Promise<PackageManifest> {
    const invalid = (message: string) =>
      reader.failure ?? new ArkvoryError('invalid_input', message);
    const zip = await new Promise<ZipFile>((resolve, reject) => {
      fromRandomAccessReader(reader, size, zipOptions, (error, value) => {
        if (error) reject(invalid('Invalid UPack ZIP'));
        else resolve(value);
      });
    });
    return new Promise<PackageManifest>((resolve, reject) => {
      let count = 0,
        total = 0,
        manifest: PackageManifest | undefined;
      const names = new Set<string>();
      let settled = false;
      const fail = () => {
        if (!settled) {
          settled = true;
          zip.close();
          reject(invalid('Unsafe or invalid UPack archive'));
        }
      };
      zip.on('error', fail);
      zip.on('end', () => {
        if (!settled) {
          settled = true;
          if (manifest) resolve(manifest);
          else reject(new ArkvoryError('invalid_input', 'Root upack.json is required'));
        }
      });
      zip.on('entry', (entry: Entry) => {
        try {
          count++;
          total += entry.uncompressedSize;
          const path = entry.fileName.endsWith('/') ? entry.fileName.slice(0, -1) : entry.fileName;
          requireAssetPath(path);
          const mode = Math.floor(entry.externalFileAttributes / 65536) % 65536;
          if (
            count > 100000 ||
            total > 100 * 1024 ** 3 ||
            names.has(path) ||
            (mode & 0xf000) === 0xa000 ||
            entry.isEncrypted()
          )
            throw new Error('Unsafe ZIP');
          names.add(path);
          if (entry.fileName !== 'upack.json') {
            zip.readEntry();
            return;
          }
          if (entry.uncompressedSize > 65536) throw new Error('Large manifest');
          zip.openReadStream(entry, (error, stream) => {
            if (error) {
              fail();
              return;
            }
            const chunks: Buffer[] = [];
            let bytes = 0;
            stream.on('error', fail);
            stream.on('data', (chunk: Buffer) => {
              bytes += chunk.length;
              if (bytes > 65536) {
                stream.destroy();
                fail();
              } else chunks.push(chunk);
            });
            stream.on('end', () => {
              try {
                const value: unknown = JSON.parse(
                  new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
                    Buffer.concat(chunks),
                  ),
                );
                manifest = parseManifest(value);
                zip.readEntry();
              } catch {
                fail();
              }
            });
          });
        } catch {
          fail();
        }
      });
      zip.readEntry();
    });
  }
}
