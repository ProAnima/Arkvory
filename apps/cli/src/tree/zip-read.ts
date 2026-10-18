import { createReadStream } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { pipeline } from 'node:stream';
import { createInflateRaw } from 'node:zlib';
import { CliError } from '../errors.js';
import { TREE_LIMITS, TreeNames, treePath } from './tree-paths.js';

/** One file entry of an archive, read from its central directory and local header. */
export interface ArchiveEntry {
  readonly path: string;
  /** 0 stored, 8 deflate. */
  readonly method: number;
  readonly crc32: number;
  readonly size: number;
  readonly compressedSize: number;
  readonly localHeaderOffset: number;
  /** 0o755 when the archive marks the file executable for its owner (UNIX), else 0o644. */
  readonly mode: number;
}

const MAX32 = 0xffffffff;
/** The central directory of 100 000 entries with long names fits easily. */
const MAX_DIRECTORY_BYTES = 256 * 1024 ** 2;
const invalid = () => new CliError('invalid_archive', 5);

async function readAt(handle: FileHandle, position: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  let done = 0;
  while (done < length) {
    const { bytesRead } = await handle.read(buffer, done, length - done, position + done);
    if (bytesRead === 0) throw invalid();
    done += bytesRead;
  }
  return buffer;
}

const safe = (value: bigint) => {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw invalid();
  return Number(value);
};

/** Where the central directory is and how many entries it has; ZIP64 when the classic is full. */
async function directoryOf(handle: FileHandle, size: number) {
  const tail = Math.min(size, 22 + 0xffff);
  const buffer = await readAt(handle, size - tail, tail);
  let at = -1;
  for (let index = tail - 22; index >= 0; index--)
    if (
      buffer.readUInt32LE(index) === 0x06054b50 &&
      index + 22 + buffer.readUInt16LE(index + 20) === tail
    ) {
      at = index;
      break;
    }
  if (at < 0) throw new CliError('not_archive', 5);
  const position = size - tail + at;
  if (buffer.readUInt16LE(at + 4) !== 0 || buffer.readUInt16LE(at + 6) !== 0) throw invalid();
  let count = buffer.readUInt16LE(at + 10);
  let length = buffer.readUInt32LE(at + 12);
  let offset = buffer.readUInt32LE(at + 16);
  if (count === 0xffff || length === MAX32 || offset === MAX32) {
    if (position < 20) throw invalid();
    const locator = await readAt(handle, position - 20, 20);
    if (locator.readUInt32LE(0) !== 0x07064b50) throw invalid();
    const recordAt = safe(locator.readBigUInt64LE(8));
    const record = await readAt(handle, recordAt, 56);
    if (record.readUInt32LE(0) !== 0x06064b50) throw invalid();
    count = safe(record.readBigUInt64LE(32));
    length = safe(record.readBigUInt64LE(40));
    offset = safe(record.readBigUInt64LE(48));
  }
  if (count > TREE_LIMITS.entries * 2 || length > MAX_DIRECTORY_BYTES || offset + length > size)
    throw new CliError('too_many_entries', 5);
  return { count, length, offset };
}

function zip64Values(extra: Buffer, wanted: readonly boolean[]): (number | undefined)[] {
  for (let at = 0; at + 4 <= extra.length;) {
    const id = extra.readUInt16LE(at);
    const length = extra.readUInt16LE(at + 2);
    if (at + 4 + length > extra.length) throw invalid();
    if (id === 0x0001) {
      let field = at + 4;
      return wanted.map((want) => {
        if (!want) return undefined;
        if (field + 8 > at + 4 + length) throw invalid();
        const value = safe(extra.readBigUInt64LE(field));
        field += 8;
        return value;
      });
    }
    at += 4 + length;
  }
  if (wanted.some(Boolean)) throw invalid();
  return wanted.map(() => undefined);
}

function nameOf(bytes: Buffer, utf8: boolean): string {
  // Without the UTF-8 flag a name is CP437: only its ASCII part means the same everywhere.
  if (!utf8 && bytes.some((byte) => byte >= 0x80)) throw new CliError('unsafe_name', 5);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new CliError('unsafe_name', 5);
  }
}

/** One central directory record at `at`; null for a directory entry. */
function parseRecord(directory: Buffer, at: number): { entry: ArchiveEntry | null; next: number } {
  if (at + 46 > directory.length || directory.readUInt32LE(at) !== 0x02014b50) throw invalid();
  const flags = directory.readUInt16LE(at + 8);
  const method = directory.readUInt16LE(at + 10);
  const nameLength = directory.readUInt16LE(at + 28);
  const extraLength = directory.readUInt16LE(at + 30);
  const next = at + 46 + nameLength + extraLength + directory.readUInt16LE(at + 32);
  if (next > directory.length || directory.readUInt16LE(at + 34) !== 0) throw invalid();
  const raw = nameOf(directory.subarray(at + 46, at + 46 + nameLength), (flags & 0x0800) !== 0);
  const external = directory.readUInt32LE(at + 38);
  const unix = directory.readUInt8(at + 5) === 3;
  const type = (external >>> 16) & 0o170000;
  if (raw.endsWith('/')) {
    treePath(raw.slice(0, -1));
    return { entry: null, next };
  }
  // Encrypted entries, links and other special files never become files of the tree.
  if (flags & 0x0001 || (unix && type !== 0 && type !== 0o100000))
    throw new CliError('unsupported_entry', 5);
  if (method !== 0 && method !== 8) throw new CliError('unsupported_method', 5);
  const classic = [at + 24, at + 20, at + 42].map((field) => directory.readUInt32LE(field));
  const extra = directory.subarray(at + 46 + nameLength, at + 46 + nameLength + extraLength);
  const wide = zip64Values(
    extra,
    classic.map((value) => value === MAX32),
  );
  const [size, compressedSize, localHeaderOffset] = classic.map((value, i) => wide[i] ?? value);
  if (size === undefined || compressedSize === undefined || localHeaderOffset === undefined)
    throw invalid();
  return {
    entry: {
      path: treePath(raw),
      method,
      crc32: directory.readUInt32LE(at + 16),
      size,
      compressedSize,
      localHeaderOffset,
      mode: unix && ((external >>> 16) & 0o100) !== 0 ? 0o755 : 0o644,
    },
    next,
  };
}

/**
 * The file entries of the archive behind `handle`, in archive order, read as untrusted input:
 * paths by the tree rules (`path_outside_root`, `unsafe_name`, `duplicate_entry`,
 * `case_collision`), only stored and deflate (`unsupported_method`), no encryption, links or
 * special files (`unsupported_entry`), at most 100 000 files (`too_many_entries`). Directory
 * entries are checked and skipped.
 */
export async function archiveEntries(
  handle: FileHandle,
  size: number,
): Promise<readonly ArchiveEntry[]> {
  const { count, length, offset } = await directoryOf(handle, size);
  const directory = await readAt(handle, offset, length);
  const names = new TreeNames();
  const entries: ArchiveEntry[] = [];
  let at = 0;
  for (let index = 0; index < count; index++) {
    const { entry, next } = parseRecord(directory, at);
    at = next;
    if (entry === null) continue;
    if (entry.localHeaderOffset + 30 + entry.compressedSize > offset) throw invalid();
    names.add(entry.path);
    entries.push(entry);
  }
  return entries;
}

/** Where the entry's data starts, after its local header. */
export async function dataOffset(handle: FileHandle, entry: ArchiveEntry): Promise<number> {
  const header = await readAt(handle, entry.localHeaderOffset, 30);
  if (header.readUInt32LE(0) !== 0x04034b50) throw invalid();
  return entry.localHeaderOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
}

/**
 * The content of an entry as a stream: its data range, inflated for deflate. More bytes than
 * the entry's size are refused at once; the caller checks size, CRC-32 and SHA-256.
 */
export async function* entryContent(
  file: string,
  handle: FileHandle,
  entry: ArchiveEntry,
  signal: AbortSignal,
): AsyncGenerator<Uint8Array> {
  if (entry.compressedSize === 0) return;
  const start = await dataOffset(handle, entry);
  const raw = createReadStream(file, {
    start,
    end: start + entry.compressedSize - 1,
    highWaterMark: 1024 * 1024,
    signal,
  });
  // A failure of the file read ends the inflate stream with it (pipeline).
  const source: AsyncIterable<unknown> =
    entry.method === 8 ? pipeline(raw, createInflateRaw(), () => undefined) : raw;
  let produced = 0;
  for await (const chunk of source) {
    if (!(chunk instanceof Uint8Array)) throw invalid();
    produced += chunk.length;
    if (produced > entry.size) throw new CliError('checksum_mismatch', 5);
    yield chunk;
  }
}
