import { mkdir, open as openFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { open } from 'yauzl';
import type { ZipFile, Entry } from 'yauzl';
import type { Readable } from 'node:stream';
import { inside } from './files.js';

export function archivePath(root: string, name: string, attributes: number): string {
  // Reject Windows device names/ADS and all links, including on a Linux packaging host.
  const kind = Math.floor(attributes / 65536) & 0o170000;
  if (kind !== 0 && kind !== 0o100000 && kind !== 0o040000)
    throw new Error('Archive contains special file');
  if (
    name.includes('\\') ||
    name.startsWith('/') ||
    name
      .split('/')
      .some(
        (part) =>
          !part ||
          part === '.' ||
          part === '..' ||
          /[:<>"|?*]/.test(part) ||
          /\p{Cc}/u.test(part) ||
          /[. ]$/.test(part) ||
          /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part),
      )
  )
    throw new Error('Unsafe archive path');
  return inside(root, name);
}
async function extractEntry(zip: ZipFile, entry: Entry, root: string): Promise<void> {
  const directory = entry.fileName.endsWith('/');
  const name = directory ? entry.fileName.slice(0, -1) : entry.fileName;
  const path = archivePath(root, name, entry.externalFileAttributes);
  if (directory) {
    await mkdir(path, { recursive: true });
    return;
  }
  if (entry.uncompressedSize > 256 * 1024 ** 2) throw new Error('Release entry exceeds limit');
  await mkdir(dirname(path), { recursive: true });
  const stream = await new Promise<Readable>((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error) reject(error);
      else resolve(stream);
    });
  });
  const file = await openFile(path, 'wx', 0o644);
  let size = 0;
  try {
    for await (const raw of stream) {
      const chunk: unknown = raw;
      if (!Buffer.isBuffer(chunk)) throw new Error('Invalid archive stream');
      size += chunk.length;
      if (size > entry.uncompressedSize) throw new Error('Archive length mismatch');
      await file.writeFile(chunk);
    }
    if (size !== entry.uncompressedSize) throw new Error('Truncated archive entry');
    await file.chmod(0o644);
    await file.sync();
  } finally {
    stream.destroy();
    await file.close();
  }
}
export async function extractArchive(path: string, destination: string): Promise<void> {
  // Destination must be new and private: pre-existing links can otherwise escape lexical containment.
  await mkdir(destination, { mode: 0o700 });
  const zip = await new Promise<ZipFile>((resolve, reject) => {
    open(path, { lazyEntries: true, autoClose: true, strictFileNames: true }, (error, zip) => {
      if (error) reject(error);
      else resolve(zip);
    });
  });
  await new Promise<void>((resolve, reject) => {
    let count = 0;
    let bytes = 0;
    const fail = (error: unknown) => {
      zip.close();
      reject(error instanceof Error ? error : new Error('Archive extraction failed'));
    };
    zip.on('error', fail);
    zip.on('end', resolve);
    zip.on('entry', (entry: Entry) => {
      count++;
      bytes += entry.uncompressedSize;
      if (count > 60000 || bytes > 2 * 1024 ** 3) {
        fail(new Error('Release expansion limit exceeded'));
        return;
      }
      void extractEntry(zip, entry, destination).then(() => {
        zip.readEntry();
      }, fail);
    });
    zip.readEntry();
  });
}
