import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import { crc32 } from 'node:zlib';
import { fromRandomAccessReader } from 'yauzl';
import type { Entry, ZipFile } from 'yauzl';
import {
  TREE_MAX_ENTRIES,
  TREE_MAX_TOTAL_BYTES,
  requireAssetPath,
  treePathKey,
} from '@proanima/arkvory-domain';
import type {
  ArchiveTree,
  ArchiveTreeEntry,
  TreeEntryMethod,
  TreeIndexReason,
} from '@proanima/arkvory-domain';
import type {
  ArchiveTreeBuilder,
  BlobStore,
  Cancellation,
  TreeIndexCandidate,
} from '@proanima/arkvory-application';
import type { PostgresContentPins } from './content-pins.js';
import { BlobRangeReader } from './blob-range-reader.js';

/** A defect of the archive itself: the table is `unavailable` for good. */
class Refusal extends Error {
  constructor(readonly reason: TreeIndexReason) {
    super(reason);
  }
}

const zipOptions = {
  lazyEntries: true,
  autoClose: false,
  strictFileNames: true,
  validateEntrySizes: true,
} as const;

/** Unix file types an entry may carry in the upper half of its external attributes. */
const fileTypes = new Set([0, 0x8000]);
const directoryTypes = new Set([0, 0x4000]);

/**
 * The table of contents of a published ZIP (ADR 0083, N8): read only through
 * `BlobStore.read(range)` under a shared content pin, entry by entry, with the limits of UPack
 * parsing. Every file entry is read once to hash its content and check its CRC-32 and size;
 * memory is one read window, one entry's stream buffers and the table itself (at most
 * TREE_MAX_ENTRIES paths of at most 1024 characters).
 *
 * Deviation from ADR 0083, N10: the core compute pool does not exist yet, so deflate entries are
 * inflated by zlib's asynchronous streams, which run on the libuv thread pool; hashing runs on
 * the event loop in chunks of at most 64 KiB, so it never holds the loop for long.
 */
export class ZipTreeBuilder implements ArchiveTreeBuilder {
  constructor(
    private readonly blobs: BlobStore,
    private readonly pins?: Pick<PostgresContentPins, 'acquire'>,
  ) {}

  async build(blob: TreeIndexCandidate, cancellation: Cancellation): Promise<ArchiveTree> {
    cancellation.throwIfAborted();
    const pin = await this.pins?.acquire(blob.id);
    try {
      // Checked before every range read and between the chunks of one: a stop or a lost pin
      // ends the parse within one chunk.
      const check = () => {
        cancellation.throwIfAborted();
        pin?.check();
      };
      const reader = new BlobRangeReader(this.blobs, blob, { check });
      let tree: ArchiveTree;
      try {
        tree = { status: 'ready', entries: await readTree(reader, blob.size, cancellation) };
      } catch (error) {
        // yauzl reports every failure as an archive error: the port's own one (or the abort)
        // is kept by the reader and wins, so a storage failure is retried, not recorded.
        if (reader.failure) throw reader.failure;
        cancellation.throwIfAborted();
        if (!(error instanceof Refusal)) throw error;
        tree = { status: 'unavailable', reason: error.reason };
      }
      pin?.check();
      return tree;
    } finally {
      await pin?.release();
    }
  }
}

/** What yauzl's message says about the archive; anything unrecognized is a broken archive. */
function refusalOf(error: unknown): Refusal {
  if (error instanceof Refusal) return error;
  const message = error instanceof Error ? error.message : '';
  if (/^(absolute path|invalid relative path|invalid characters in fileName)/.test(message))
    return new Refusal('unsafe_entry');
  if (message.startsWith('strong encryption')) return new Refusal('encrypted_entry');
  return new Refusal('invalid_archive');
}

function openZip(reader: BlobRangeReader, size: number): Promise<ZipFile> {
  return new Promise<ZipFile>((resolve, reject) => {
    fromRandomAccessReader(reader, size, zipOptions, (error, zip) => {
      if (!error) resolve(zip);
      else if (/end of central directory record signature not found/i.test(error.message))
        reject(new Refusal('not_archive'));
      else reject(new Refusal('invalid_archive'));
    });
  });
}

/** The central directory one entry at a time; yauzl's errors become refusals. */
async function* entriesOf(zip: ZipFile): AsyncGenerator<Entry> {
  const iterator = zip.eachEntry();
  try {
    for (;;) {
      let next: IteratorResult<Entry>;
      try {
        next = await iterator.next();
      } catch (error) {
        throw refusalOf(error);
      }
      if (next.done === true) return;
      yield next.value;
    }
  } finally {
    await iterator.return?.();
  }
}

async function readTree(
  reader: BlobRangeReader,
  size: number,
  cancellation: Cancellation,
): Promise<ArchiveTreeEntry[]> {
  const zip = await openZip(reader, size);
  try {
    if (zip.entryCount > TREE_MAX_ENTRIES) throw new Refusal('too_many_entries');
    const entries: ArchiveTreeEntry[] = [];
    const seen = new Set<string>();
    let total = 0;
    for await (const entry of entriesOf(zip)) {
      cancellation.throwIfAborted();
      total += entry.uncompressedSize;
      if (total > TREE_MAX_TOTAL_BYTES) throw new Refusal('too_large');
      const file = admit(entry, seen);
      if (file) entries.push(await readFile(zip, entry, file, entries.length));
    }
    return entries;
  } finally {
    zip.close();
  }
}

/** The path and method of a file entry, undefined for a directory; refuses unsafe entries. */
function admit(
  entry: Entry,
  seen: Set<string>,
): { readonly path: string; readonly method: TreeEntryMethod } | undefined {
  const directory = entry.fileName.endsWith('/');
  const path = directory ? entry.fileName.slice(0, -1) : entry.fileName;
  try {
    requireAssetPath(path);
  } catch {
    throw new Refusal('unsafe_entry');
  }
  // Links, devices, FIFOs and sockets would make a client create something other than a file.
  const type = Math.floor(entry.externalFileAttributes / 65536) & 0xf000;
  if (!(directory ? directoryTypes : fileTypes).has(type)) throw new Refusal('unsafe_entry');
  if (entry.isEncrypted()) throw new Refusal('encrypted_entry');
  const key = treePathKey(path);
  if (seen.has(key)) throw new Refusal('duplicate_entry');
  seen.add(key);
  if (directory) return undefined;
  if (entry.compressionMethod === 0) return { path, method: 'stored' };
  if (entry.compressionMethod === 8) return { path, method: 'deflate' };
  throw new Refusal('unsupported_method');
}

function dataStart(zip: ZipFile, entry: Entry): Promise<number> {
  // Checks the local header signature and that the data ends inside the archive.
  return zip.readLocalFileHeaderPromise(entry, { minimal: true }).then(
    (header) => header.fileDataStart,
    (error: unknown) => {
      throw refusalOf(error);
    },
  );
}

function dataStream(
  zip: ZipFile,
  entry: Entry,
  start: number,
  method: TreeEntryMethod,
): Promise<Readable> {
  return new Promise<Readable>((resolve, reject) => {
    // The low-level stream reads exactly [start, start + compressedSize) and inflates deflate
    // data, checking the inflated byte count against the central directory.
    zip.openReadStreamLowLevel(
      start,
      entry.compressedSize,
      0,
      entry.compressedSize,
      method === 'deflate',
      entry.uncompressedSize,
      (error, stream) => {
        if (error) reject(refusalOf(error));
        else resolve(stream);
      },
    );
  });
}

/** Streams one file entry: SHA-256 and CRC-32 of its content, its size and data range. */
async function readFile(
  zip: ZipFile,
  entry: Entry,
  file: { readonly path: string; readonly method: TreeEntryMethod },
  ordinal: number,
): Promise<ArchiveTreeEntry> {
  const start = await dataStart(zip, entry);
  const stream = await dataStream(zip, entry, start, file.method);
  const hash = createHash('sha256');
  let crc = 0;
  let size = 0;
  try {
    for await (const chunk of stream as AsyncIterable<unknown>) {
      if (!(chunk instanceof Uint8Array)) throw new Refusal('invalid_archive');
      hash.update(chunk);
      crc = crc32(chunk, crc);
      size += chunk.byteLength;
    }
  } catch (error) {
    throw refusalOf(error);
  } finally {
    stream.destroy();
  }
  if (size !== entry.uncompressedSize) throw new Refusal('invalid_archive');
  if (crc >>> 0 !== entry.crc32 >>> 0) throw new Refusal('crc_mismatch');
  return {
    ordinal,
    path: file.path,
    size,
    sha256: hash.digest('hex'),
    method: file.method,
    dataOffset: start,
    dataLength: entry.compressedSize,
  };
}
