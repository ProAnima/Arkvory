import { SigningError } from './errors.js';
import { safePath } from './package-paths.js';

const BLOCK = 512;

/** An entry header that passed the format and path rules; its data follows through a sink. */
export interface TarEntry {
  readonly path: string;
  readonly kind: 'file' | 'directory';
  readonly size: number;
}

/** Receives the data of one entry in order; awaiting a write is the backpressure of the read. */
export interface TarSink {
  write(chunk: Buffer): void | Promise<void>;
  end(): void | Promise<void>;
}

export interface TarLimits {
  /** Bytes of the uncompressed archive, headers included. */
  readonly totalBytes: number;
  readonly entries: number;
}

function field(header: Buffer, start: number, length: number): Buffer {
  const raw = header.subarray(start, start + length);
  const end = raw.indexOf(0);
  return end === -1 ? raw : raw.subarray(0, end);
}

function octal(header: Buffer, start: number, length: number): number {
  const raw = header.subarray(start, start + length);
  // Base-256 sizes (high bit set) exist only for entries beyond 8 GiB; refused, never decoded.
  if (((raw[0] ?? 0) & 0x80) !== 0) throw new SigningError('archive_invalid');
  const text = raw
    .toString('latin1')
    .replace(/[\0 ]+$/, '')
    .replace(/^ +/, '');
  if (!/^[0-7]{1,11}$/.test(text)) throw new SigningError('archive_invalid');
  return Number.parseInt(text, 8);
}

function checksum(header: Buffer): void {
  let sum = 0;
  for (let index = 0; index < BLOCK; index++)
    sum += index >= 148 && index < 156 ? 0x20 : (header[index] ?? 0);
  if (octal(header, 148, 8) !== sum) throw new SigningError('archive_invalid');
}

function entryPath(header: Buffer): string {
  const name = field(header, 0, 100);
  const prefix = field(header, 345, 155);
  const bytes = prefix.length ? Buffer.concat([prefix, Buffer.from('/'), name]) : name;
  // Only printable ASCII reaches the path rules: no encoding decides what a name means.
  if (bytes.some((byte) => byte < 0x21 || byte > 0x7e)) throw new SigningError('unsafe_path');
  return bytes.toString('latin1');
}

/**
 * Reads one POSIX ustar header. Links, devices, FIFOs and extended headers (pax, GNU long
 * names) are refused: format 1 has no use for them, and each is a way for an entry to mean
 * something else than its name.
 */
export function readHeader(header: Buffer): TarEntry {
  checksum(header);
  if (
    field(header, 257, 6).toString('latin1') !== 'ustar' ||
    header.toString('latin1', 263, 265) !== '00'
  )
    throw new SigningError('archive_invalid');
  const type = String.fromCharCode(header[156] ?? 0);
  if (type === '1' || type === '2') throw new SigningError('link_entry');
  if (['x', 'g', 'L', 'K'].includes(type)) throw new SigningError('extended_header');
  if (type !== '0' && type !== '\0' && type !== '5') throw new SigningError('special_entry');
  const raw = entryPath(header);
  const path = safePath(raw);
  const size = octal(header, 124, 12);
  const kind = type === '5' ? 'directory' : 'file';
  if (kind === 'directory' && size !== 0) throw new SigningError('archive_invalid', path);
  if (kind === 'file' && raw.endsWith('/')) throw new SigningError('unsafe_path', path);
  return { path, kind, size };
}

/**
 * Streams a tar archive: every header is checked before its data is read, and `visit` decides
 * from the header alone (name, kind, declared size) whether to accept the entry, so a declared
 * size is refused before a byte of it is read or any memory is set aside. The archive must end
 * with two zero blocks followed only by zero padding; anything else is `archive_invalid`.
 */
export async function readTar(
  source: AsyncIterable<unknown>,
  visit: (entry: TarEntry) => TarSink | Promise<TarSink>,
  limits: TarLimits,
): Promise<void> {
  const header = Buffer.alloc(BLOCK);
  let filled = 0;
  let total = 0;
  let entries = 0;
  let zeros = 0;
  let remaining = 0;
  let padding = 0;
  let sink: TarSink | null = null;
  for await (const raw of source) {
    if (!Buffer.isBuffer(raw)) throw new SigningError('archive_invalid');
    total += raw.length;
    if (total > limits.totalBytes) throw new SigningError('archive_too_large');
    let offset = 0;
    while (offset < raw.length) {
      if (zeros === 2) {
        if (raw.subarray(offset).some((byte) => byte !== 0))
          throw new SigningError('archive_invalid');
        break;
      }
      if (sink !== null && remaining > 0) {
        const take = Math.min(remaining, raw.length - offset);
        await sink.write(raw.subarray(offset, offset + take));
        remaining -= take;
        offset += take;
        if (remaining === 0) await sink.end();
        continue;
      }
      if (padding > 0) {
        const take = Math.min(padding, raw.length - offset);
        padding -= take;
        offset += take;
        continue;
      }
      const take = Math.min(BLOCK - filled, raw.length - offset);
      raw.copy(header, filled, offset, offset + take);
      filled += take;
      offset += take;
      if (filled < BLOCK) continue;
      filled = 0;
      if (header.every((byte) => byte === 0)) {
        zeros++;
        continue;
      }
      if (zeros !== 0) throw new SigningError('archive_invalid');
      if (++entries > limits.entries) throw new SigningError('too_many_entries');
      const entry = readHeader(header);
      sink = await visit(entry);
      remaining = entry.size;
      padding = (BLOCK - (entry.size % BLOCK)) % BLOCK;
      if (remaining === 0) await sink.end();
    }
  }
  if (zeros !== 2 || remaining !== 0 || padding !== 0 || filled !== 0)
    throw new SigningError('archive_invalid');
}
