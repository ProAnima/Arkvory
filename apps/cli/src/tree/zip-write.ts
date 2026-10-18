import { createReadStream } from 'node:fs';
import { lstat, open, readdir } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, pipeline } from 'node:stream';
import { createDeflateRaw, crc32 } from 'node:zlib';
import { CliError } from '../errors.js';
import { TreeNames, relativeTreePath, treePath } from './tree-paths.js';

/** One file of a directory, in the order the archive lists it. */
export interface TreeFile {
  /** `/`-separated path under the root. */
  readonly path: string;
  readonly absolute: string;
  readonly size: number;
  /** 0o755 for a file its owner may execute (POSIX), otherwise 0o644. */
  readonly mode: number;
}

const MAX32 = 0xffffffff;
/** Above this size an entry gets ZIP64 sizes: deflate may grow incompressible data a little. */
const ZIP64_FROM = 0xf0000000;
/** 1980-01-01 00:00:00, the first DOS date: every entry carries it, so archives are equal. */
const DOS_DATE = 0x0021;
const UTF8_NAMES = 0x0800;

/**
 * The regular files under `root`, sorted by path (code points), without following links. A link,
 * a device, a FIFO or a socket anywhere in the tree is refused (`tree_entry_unsupported`): it
 * would not mean the same after extraction (ADR 0081, 1). Empty directories are not kept.
 */
export async function treeFiles(root: string, signal: AbortSignal): Promise<readonly TreeFile[]> {
  const files: TreeFile[] = [];
  const names = new TreeNames();
  const pending = [root];
  while (pending.length) {
    signal.throwIfAborted();
    const directory = pending.pop() ?? root;
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const absolute = join(directory, item.name);
      if (item.isDirectory()) {
        pending.push(absolute);
        continue;
      }
      if (!item.isFile()) throw new CliError('tree_entry_unsupported', 7);
      const path = treePath(relativeTreePath(root, absolute));
      names.add(path);
      const info = await lstat(absolute);
      const executable = process.platform !== 'win32' && (info.mode & 0o100) !== 0;
      files.push({ path, absolute, size: info.size, mode: executable ? 0o755 : 0o644 });
    }
  }
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

interface Written {
  readonly name: Buffer;
  readonly method: number;
  readonly crc: number;
  readonly compressed: number;
  readonly size: number;
  readonly offset: number;
  readonly mode: number;
}

async function writeAt(handle: FileHandle, bytes: Uint8Array, position: number): Promise<void> {
  let done = 0;
  while (done < bytes.length) {
    const { bytesWritten } = await handle.write(bytes, done, bytes.length - done, position + done);
    if (bytesWritten === 0) throw new CliError('disk_write_failed', 7);
    done += bytesWritten;
  }
}

function localHeader(name: Buffer, method: number, zip64: boolean): Buffer {
  const header = Buffer.alloc(30 + name.length + (zip64 ? 20 : 0));
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(zip64 ? 45 : 20, 4);
  header.writeUInt16LE(UTF8_NAMES, 6);
  header.writeUInt16LE(method, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(DOS_DATE, 12);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(zip64 ? 20 : 0, 28);
  name.copy(header, 30);
  if (zip64) {
    header.writeUInt32LE(MAX32, 18);
    header.writeUInt32LE(MAX32, 22);
    header.writeUInt16LE(0x0001, 30 + name.length);
    header.writeUInt16LE(16, 32 + name.length);
  }
  return header;
}

/** Streams one file's bytes (deflated with `compress`) into the archive at `position`. */
async function writeData(
  handle: FileHandle,
  file: TreeFile,
  compress: boolean,
  position: number,
  signal: AbortSignal,
): Promise<{ crc: number; compressed: number; size: number }> {
  let crc = 0;
  let size = 0;
  let compressed = 0;
  const source = createReadStream(file.absolute, { highWaterMark: 1024 * 1024, signal });
  const counted = (async function* () {
    for await (const chunk of source) {
      if (!(chunk instanceof Uint8Array)) throw new CliError('invalid_file_stream', 7);
      crc = crc32(chunk, crc);
      size += chunk.length;
      yield chunk;
    }
  })();
  // zlib deflates on the libuv thread pool, not on the event loop.
  const stream: AsyncIterable<unknown> = compress
    ? pipeline(Readable.from(counted), createDeflateRaw(), () => undefined)
    : counted;
  for await (const chunk of stream) {
    if (!(chunk instanceof Uint8Array)) throw new CliError('invalid_file_stream', 7);
    await writeAt(handle, chunk, position + compressed);
    compressed += chunk.length;
  }
  // The file changed while it was packed: the archive would not hold one state of it.
  if (size !== file.size) throw new CliError('file_changed', 6);
  return { crc, compressed, size };
}

/** One local header and its data; the header is completed once CRC-32 and sizes are known. */
async function writeEntry(
  handle: FileHandle,
  file: TreeFile,
  compress: boolean,
  offset: number,
  signal: AbortSignal,
): Promise<Written> {
  const name = Buffer.from(file.path, 'utf8');
  const method = compress && file.size > 0 ? 8 : 0;
  const zip64 = file.size >= ZIP64_FROM;
  const header = localHeader(name, method, zip64);
  await writeAt(handle, header, offset);
  const data = await writeData(handle, file, method === 8, offset + header.length, signal);
  if (!zip64 && data.compressed >= MAX32) throw new CliError('entry_too_large', 7);
  const patch = Buffer.alloc(zip64 ? 4 : 12);
  patch.writeUInt32LE(data.crc >>> 0, 0);
  if (!zip64) {
    patch.writeUInt32LE(data.compressed, 4);
    patch.writeUInt32LE(data.size, 8);
  }
  await writeAt(handle, patch, offset + 14);
  if (zip64) {
    const sizes = Buffer.alloc(16);
    sizes.writeBigUInt64LE(BigInt(data.size), 0);
    sizes.writeBigUInt64LE(BigInt(data.compressed), 8);
    await writeAt(handle, sizes, offset + 30 + name.length + 4);
  }
  return { name, method, ...data, offset, mode: file.mode };
}

function centralHeader(entry: Written): Buffer {
  const fields: bigint[] = [];
  if (entry.size >= MAX32) fields.push(BigInt(entry.size));
  if (entry.compressed >= MAX32) fields.push(BigInt(entry.compressed));
  if (entry.offset >= MAX32) fields.push(BigInt(entry.offset));
  const extra = fields.length ? 4 + 8 * fields.length : 0;
  const zip64 = fields.length > 0 || entry.size >= ZIP64_FROM;
  const header = Buffer.alloc(46 + entry.name.length + extra);
  header.writeUInt32LE(0x02014b50, 0);
  // Made by UNIX (3), so the external attributes carry the file mode.
  header.writeUInt16LE((3 << 8) | (zip64 ? 45 : 20), 4);
  header.writeUInt16LE(zip64 ? 45 : 20, 6);
  header.writeUInt16LE(UTF8_NAMES, 8);
  header.writeUInt16LE(entry.method, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(DOS_DATE, 14);
  header.writeUInt32LE(entry.crc >>> 0, 16);
  header.writeUInt32LE(Math.min(entry.compressed, MAX32), 20);
  header.writeUInt32LE(Math.min(entry.size, MAX32), 24);
  header.writeUInt16LE(entry.name.length, 28);
  header.writeUInt16LE(extra, 30);
  header.writeUInt32LE(((0o100000 | entry.mode) << 16) >>> 0, 38);
  header.writeUInt32LE(Math.min(entry.offset, MAX32), 42);
  entry.name.copy(header, 46);
  if (extra) {
    header.writeUInt16LE(0x0001, 46 + entry.name.length);
    header.writeUInt16LE(extra - 4, 48 + entry.name.length);
    fields.forEach((value, index) => {
      header.writeBigUInt64LE(value, 50 + entry.name.length + index * 8);
    });
  }
  return header;
}

/** The end records; ZIP64 ones when the count or a position does not fit the classic fields. */
function endRecords(count: number, directoryOffset: number, directorySize: number): Buffer {
  const zip64 = count > 0xffff || directoryOffset >= MAX32 || directorySize >= MAX32;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Math.min(count, 0xffff), 8);
  end.writeUInt16LE(Math.min(count, 0xffff), 10);
  end.writeUInt32LE(Math.min(directorySize, MAX32), 12);
  end.writeUInt32LE(Math.min(directoryOffset, MAX32), 16);
  if (!zip64) return end;
  const record = Buffer.alloc(56);
  record.writeUInt32LE(0x06064b50, 0);
  record.writeBigUInt64LE(44n, 4);
  record.writeUInt16LE((3 << 8) | 45, 12);
  record.writeUInt16LE(45, 14);
  record.writeBigUInt64LE(BigInt(count), 24);
  record.writeBigUInt64LE(BigInt(count), 32);
  record.writeBigUInt64LE(BigInt(directorySize), 40);
  record.writeBigUInt64LE(BigInt(directoryOffset), 48);
  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(0x07064b50, 0);
  locator.writeBigUInt64LE(BigInt(directoryOffset + directorySize), 8);
  locator.writeUInt32LE(1, 16);
  return Buffer.concat([record, locator, end]);
}

/**
 * Packs the files into a new ZIP at `output` (ADR 0083, N8, T1): entries in path order, every
 * timestamp 1980-01-01, the owner-execute bit kept as mode 0755, nothing else of the file
 * system, so one directory state always gives the same bytes and the same SHA-256 — a repeated
 * push resumes its upload. Entries are `stored` (the data range of an entry is then exactly the
 * file) unless `compress`; ZIP64 where sizes, offsets or the count need it.
 */
export async function writeTreeArchive(
  files: readonly TreeFile[],
  output: string,
  compress: boolean,
  signal: AbortSignal,
): Promise<{ readonly size: number }> {
  const handle = await open(output, 'wx', 0o600);
  try {
    const written: Written[] = [];
    let offset = 0;
    for (const file of files) {
      signal.throwIfAborted();
      const entry = await writeEntry(handle, file, compress, offset, signal);
      written.push(entry);
      offset = entry.offset + 30 + entry.name.length + (entry.size >= ZIP64_FROM ? 20 : 0);
      offset += entry.compressed;
    }
    const directoryOffset = offset;
    for (const entry of written) {
      const header = centralHeader(entry);
      await writeAt(handle, header, offset);
      offset += header.length;
    }
    const end = endRecords(written.length, directoryOffset, offset - directoryOffset);
    await writeAt(handle, end, offset);
    await handle.sync();
    return { size: offset + end.length };
  } finally {
    await handle.close();
  }
}
