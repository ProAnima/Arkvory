import { open } from 'yauzl';
import type { Entry, ZipFile } from 'yauzl';
import { DepotError, parseManifest, requireAssetPath } from '@proanima/depot-domain';
import type { PackageManifest } from '@proanima/depot-domain';
import type { ManifestReader } from '@proanima/depot-application';
import type { LocalBlobStore } from './local-blobs.js';

export class ZipManifestReader implements ManifestReader {
  constructor(private readonly blobs: LocalBlobStore) {}
  async inspect(id: string): Promise<PackageManifest> {
    const zip = await new Promise<ZipFile>((resolve, reject) => {
      open(
        this.blobs.contentPath(id),
        { lazyEntries: true, autoClose: true, strictFileNames: true, validateEntrySizes: true },
        (error, value) => {
          if (error) reject(new DepotError('invalid_input', 'Invalid UPack ZIP'));
          else resolve(value);
        },
      );
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
          reject(new DepotError('invalid_input', 'Unsafe or invalid UPack archive'));
        }
      };
      zip.on('error', fail);
      zip.on('end', () => {
        if (!settled) {
          settled = true;
          if (manifest) resolve(manifest);
          else reject(new DepotError('invalid_input', 'Root upack.json is required'));
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
                const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
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
