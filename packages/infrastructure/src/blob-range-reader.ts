import { Readable } from 'node:stream';
import { RandomAccessReader } from 'yauzl';
import { ArkvoryError } from '@proanima/arkvory-domain';
import type { BlobStore } from '@proanima/arkvory-application';

/** A published blob: its id, exact size and the storage that holds it (ADR 0083, N9). */
export interface BlobLocation {
  readonly id: string;
  readonly size: number;
  readonly storageBackend?: string | undefined;
}

export interface BlobRangeReaderOptions {
  /** Aborts reads in flight and refuses later ones with the signal's reason. */
  readonly signal?: AbortSignal;
  /** Runs before every range read; throws to stop the parse (a lost content pin, say). */
  readonly check?: () => void;
  /** Bytes fetched at once for the small header reads of a ZIP parser; 1 MiB by default. */
  readonly windowBytes?: number;
}

/** The largest single read yauzl makes: a central directory header's name, extra and comment. */
const maxReadBytes = 3 * 0xffff + 46;
const defaultWindowBytes = 1024 * 1024;

/**
 * yauzl's random access over `BlobStore.read(range)` instead of a file descriptor, so a ZIP is
 * parsed on any storage, not only one with local files (ADR 0083, N9).
 *
 * Header reads (end records, central directory, local headers) are served from one window of
 * at most `windowBytes` (or one read, which yauzl bounds below 192 KiB): the central directory
 * is read forward, so a window is one range request for thousands of entries. A window that
 * would pass the end of the blob starts earlier instead, so the first read of the end records
 * usually holds the whole central directory of a small archive. Memory is one window; entry
 * data goes through `_readStreamForRange` as a pulled stream with backpressure.
 *
 * Every callback is delivered on a later turn of the event loop (`setImmediate`): yauzl reads
 * the next entry from inside the callback of the previous one, and synchronous delivery would
 * parse a whole central directory in one turn and one ever deeper stack.
 *
 * The first failure of the port (or the abort, or a short or long range) is kept in `failure`:
 * yauzl reports every error as a plain `Error`, and a storage failure must not read as an
 * invalid archive.
 */
export class BlobRangeReader extends RandomAccessReader {
  failure: Error | undefined;
  private window: { start: number; bytes: Buffer } | undefined;
  private readonly windowBytes: number;

  constructor(
    private readonly blobs: BlobStore,
    private readonly blob: BlobLocation,
    private readonly options: BlobRangeReaderOptions = {},
  ) {
    super();
    const windowBytes = options.windowBytes ?? defaultWindowBytes;
    if (!Number.isSafeInteger(blob.size) || blob.size < 0)
      throw new ArkvoryError('invalid_input', 'Invalid blob size');
    if (!Number.isSafeInteger(windowBytes) || windowBytes < 1)
      throw new ArkvoryError('invalid_input', 'Invalid read window');
    this.windowBytes = windowBytes;
  }

  override read(
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
    callback: (error: Error | null, bytesRead?: number) => void,
  ): void {
    this.fill(buffer, offset, length, position).then(
      () => {
        setImmediate(() => {
          callback(null, length);
        });
      },
      (error: unknown) => {
        const failure = this.fail(error);
        setImmediate(() => {
          callback(failure);
        });
      },
    );
  }

  override _readStreamForRange(start: number, end: number): Readable {
    return Readable.from(this.range(start, end), { objectMode: false, highWaterMark: 64 * 1024 });
  }

  override close(callback: (error: Error | null) => void): void {
    this.window = undefined;
    setImmediate(() => {
      callback(null);
    });
  }

  private async fill(buffer: Buffer, offset: number, length: number, position: number) {
    if (
      !Number.isSafeInteger(position) ||
      !Number.isSafeInteger(length) ||
      position < 0 ||
      length < 0 ||
      length > maxReadBytes ||
      position + length > this.blob.size ||
      offset < 0 ||
      offset + length > buffer.length
    )
      throw new ArkvoryError('invalid_input', 'ZIP read outside the archive');
    if (length === 0) return;
    let window = this.window;
    if (
      !window ||
      position < window.start ||
      position + length > window.start + window.bytes.length
    ) {
      const span = Math.max(length, this.windowBytes);
      const start = Math.max(0, Math.min(position, this.blob.size - span));
      window = { start, bytes: await this.collect(start, Math.min(this.blob.size, start + span)) };
      this.window = window;
    }
    window.bytes.copy(buffer, offset, position - window.start, position - window.start + length);
  }

  /** Bytes [start, end) of the blob in one buffer; the caller bounds `end - start`. */
  private async collect(start: number, end: number): Promise<Buffer> {
    const bytes = Buffer.allocUnsafe(end - start);
    let filled = 0;
    for await (const chunk of this.range(start, end)) {
      bytes.set(chunk, filled);
      filled += chunk.byteLength;
    }
    return bytes;
  }

  /**
   * Bytes [start, end) through the port, exactly that many. Leaving the loop (an abort, a
   * consumer that destroys the stream) returns the port's iterator, which releases its file or
   * connection. An abort also ends a read the port has not answered yet.
   */
  private async *range(start: number, end: number): AsyncGenerator<Uint8Array> {
    if (start === end) return;
    let source: AsyncIterator<Uint8Array> | undefined;
    let received = 0;
    try {
      this.guard();
      const range = { start, end: end - 1 };
      const bytes = this.blobs.read(this.blob.id, this.blob.size, range, this.blob.storageBackend);
      source = bytes[Symbol.asyncIterator]();
      for (;;) {
        const next = await this.abortable(source.next());
        if (next.done) break;
        this.guard();
        received += next.value.byteLength;
        if (received > end - start)
          throw new ArkvoryError('integrity_mismatch', 'Storage returned more than the range');
        yield next.value;
      }
    } catch (error) {
      throw this.fail(error);
    } finally {
      void source?.return?.().catch(() => undefined);
    }
    if (received !== end - start)
      throw this.fail(
        new ArkvoryError('integrity_mismatch', 'Stored content ended before its declared size'),
      );
  }

  private guard() {
    this.options.signal?.throwIfAborted();
    this.options.check?.();
  }

  private abortable<T>(pending: Promise<T>): Promise<T> {
    const signal = this.options.signal;
    if (!signal) return pending;
    return new Promise<T>((resolve, reject) => {
      const abort = () => {
        reject(this.fail(signal.reason));
      };
      if (signal.aborted) abort();
      signal.addEventListener('abort', abort, { once: true });
      pending.then(resolve, reject).finally(() => {
        signal.removeEventListener('abort', abort);
      });
    });
  }

  private fail(error: unknown): Error {
    const failure = error instanceof Error ? error : new Error('Storage read failed');
    this.failure ??= failure;
    return failure;
  }
}
