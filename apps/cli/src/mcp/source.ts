import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, realpath, stat } from 'node:fs/promises';
import type { BigIntStats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { CliError } from '../errors.js';
import { isMissing } from '../local-files.js';
import { below, windowsName } from './paths.js';

const CHUNK = 1024 * 1024;

/** Blob positions as the File API takes them: negative from the end, clamped to the size. */
function position(value: number | undefined, size: number, fallback: number): number {
  if (value === undefined) return fallback;
  const whole = Math.trunc(value);
  return whole < 0 ? Math.max(size + whole, 0) : Math.min(whole, size);
}

/**
 * A Blob whose bytes are read through one open file handle, never through the path again, so a
 * file swapped after the checks in `openSource` cannot change what is sent.
 *
 * Why a subclass: `fetch` (undici) sends only real Blob instances as a body of known length and
 * reads them through `size` and `stream()`; an object that merely looks like a Blob is sent as
 * the text "[object Blob]". The subclass passes that check and serves every read from the
 * handle. `tests/cli-mcp-write.test.mjs` sends one to a local HTTP server to keep this checked.
 * The handle belongs to the caller of `openSource`, which closes it after the transfer.
 */
export class HandleBlob extends Blob {
  readonly #handle: FileHandle;
  readonly #start: number;
  readonly #end: number;
  constructor(handle: FileHandle, start: number, end: number) {
    super([]);
    this.#handle = handle;
    this.#start = start;
    this.#end = end;
  }
  override get size(): number {
    return this.#end - this.#start;
  }
  override slice(start?: number, end?: number): HandleBlob {
    const from = position(start, this.size, 0);
    const to = Math.max(from, position(end, this.size, this.size));
    return new HandleBlob(this.#handle, this.#start + from, this.#start + to);
  }
  override stream(): ReadableStream<Uint8Array<ArrayBuffer>> {
    const handle = this.#handle;
    const end = this.#end;
    let at = this.#start;
    return new ReadableStream<Uint8Array<ArrayBuffer>>({
      async pull(controller) {
        if (at >= end) {
          controller.close();
          return;
        }
        const length = Math.min(CHUNK, end - at);
        const chunk = new Uint8Array(length);
        const { bytesRead } = await handle.read(chunk, 0, length, at);
        // The file became shorter than it was when opened.
        if (bytesRead === 0) throw new CliError('source_changed', 6);
        at += bytesRead;
        controller.enqueue(bytesRead === length ? chunk : chunk.subarray(0, bytesRead));
      },
    });
  }
  override async bytes(): Promise<Uint8Array<ArrayBuffer>> {
    const bytes = new Uint8Array(this.size);
    for (let done = 0; done < bytes.length;) {
      const { bytesRead } = await this.#handle.read(
        bytes,
        done,
        bytes.length - done,
        this.#start + done,
      );
      if (bytesRead === 0) throw new CliError('source_changed', 6);
      done += bytesRead;
    }
    return bytes;
  }
  override async arrayBuffer(): Promise<ArrayBuffer> {
    return (await this.bytes()).buffer;
  }
  override async text(): Promise<string> {
    return new TextDecoder().decode(await this.bytes());
  }
}

export interface LocalSource {
  /** Open for reading; the caller closes it. */
  readonly handle: FileHandle;
  /** Real path of the file. */
  readonly path: string;
  /** The real path relative to the root, with `/` separators, for results. */
  readonly shown: string;
  readonly blob: HandleBlob;
}

/** The real path of `lexical`; it must exist and lie below the root with every link resolved. */
async function located(root: string, lexical: string): Promise<string> {
  let real;
  try {
    real = await realpath(lexical);
  } catch (error) {
    if (isMissing(error)) throw new CliError('file_not_found', 7);
    throw error;
  }
  if (!below(root, real)) throw new CliError('path_outside_root');
  return real;
}
const same = (a: BigIntStats, b: BigIntStats) => a.dev === b.dev && a.ino === b.ino;
// No link may replace the checked last component, and a FIFO swapped in must not block `open`.
const flags =
  process.platform === 'win32'
    ? constants.O_RDONLY
    : constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

/**
 * The source of an upload: a regular file below the root, opened once. The requested path is
 * taken relative to the root; after normalization and with every link resolved it must stay
 * below it (`path_outside_root`), and it must be a regular file, not a directory, device or FIFO.
 * Once open, the handle must be the file that was checked (same device and inode) and the path
 * must still resolve to it; every byte is then read through the handle (`HandleBlob`). On
 * Windows a device name, a stream or a name Windows would trim is `invalid_path`.
 */
export async function openSource(root: string, requested: string): Promise<LocalSource> {
  if (requested.length === 0 || requested.length > 4096 || requested.includes('\0'))
    throw new CliError('invalid_path');
  const lexical = resolve(root, requested);
  if (!below(root, lexical)) throw new CliError('path_outside_root');
  if (process.platform === 'win32' && !relative(root, lexical).split(sep).every(windowsName))
    throw new CliError('invalid_path');
  const real = await located(root, lexical);
  const checked = await stat(real, { bigint: true });
  if (!checked.isFile()) throw new CliError('path_outside_root');
  const handle = await open(real, flags).catch((error: unknown) => {
    // The last component became a link (ELOOP) or vanished after the check.
    if (error instanceof Error && 'code' in error && error.code === 'ELOOP')
      throw new CliError('path_outside_root');
    throw error;
  });
  try {
    const opened = await handle.stat({ bigint: true });
    const again = await located(root, lexical);
    const now = await stat(again, { bigint: true });
    if (!opened.isFile() || again !== real || !same(opened, checked) || !same(now, opened))
      throw new CliError('path_outside_root');
    const size = Number(opened.size);
    if (!Number.isSafeInteger(size)) throw new CliError('invalid_local_file');
    return {
      handle,
      path: real,
      shown: relative(root, real).split(sep).join('/'),
      blob: new HandleBlob(handle, 0, size),
    };
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}

/**
 * SHA-256 of the source in one pass through its handle, refusing a file that contains the key
 * anywhere (`source_contains_credential`), such as the key file itself or a copy padded to any
 * size: an instruction planted in data must not be able to publish the credential. Every chunk
 * and every seam between two chunks is searched, so the cost is one `indexOf` per MiB. The
 * server verifies the final SHA-256, so what it stores is exactly what was searched here. The
 * key is only compared, never logged or returned. An encoded or compressed copy is not found;
 * the dedicated, narrowly bound key (ADR 0017) limits what such a leak could reach.
 */
export async function searchedDigest(
  blob: Blob,
  secrets: readonly string[],
  signal: AbortSignal,
): Promise<string> {
  const needles = secrets.filter((secret) => secret.length > 0).map((s) => Buffer.from(s, 'utf8'));
  const overlap = Math.max(0, ...needles.map((needle) => needle.length - 1));
  const hash = createHash('sha256');
  const reader = blob.stream().getReader();
  let tail = Buffer.alloc(0);
  try {
    for (;;) {
      signal.throwIfAborted();
      const read = await reader.read();
      if (read.done) return hash.digest('hex');
      const value: unknown = read.value;
      if (!(value instanceof Uint8Array)) throw new CliError('invalid_file_stream');
      hash.update(value);
      const chunk = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
      // A key split between two reads lies in the seam: the end of one and the start of the next.
      const seam = Buffer.concat([tail, chunk.subarray(0, overlap)]);
      if (needles.some((needle) => chunk.includes(needle) || seam.includes(needle)))
        throw new CliError('source_contains_credential');
      const joined = chunk.length >= overlap ? chunk : Buffer.concat([tail, chunk]);
      tail = Buffer.from(joined.subarray(joined.length - Math.min(overlap, joined.length)));
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}
