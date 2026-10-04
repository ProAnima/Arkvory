import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createGunzip } from 'node:zlib';
import { ArkvoryError, MAX_NPM_MANIFEST_BYTES } from '@proanima/arkvory-domain';
import type { NpmTarballFacts, NpmTarballInspector } from '@proanima/arkvory-application';

const block = 512;
const maxNameBytes = 64 * 1024;
const invalid = (message: string) => new ArkvoryError('invalid_input', message);

const text = (bytes: Uint8Array) => Buffer.from(bytes).toString('utf8');
const field = (header: Uint8Array, start: number, length: number) => {
  const bytes = header.subarray(start, start + length);
  const end = bytes.indexOf(0);
  return text(end === -1 ? bytes : bytes.subarray(0, end));
};

/** ustar size: octal digits, or base-256 with the high bit set (GNU, for 8 GiB and more). */
function entrySize(header: Uint8Array): number {
  const first = header[124] ?? 0;
  if ((first & 0x80) !== 0) {
    let size = first & 0x7f;
    for (const byte of header.subarray(125, 136)) size = size * 256 + byte;
    if (!Number.isSafeInteger(size)) throw invalid('Tar entry too large');
    return size;
  }
  const digits = field(header, 124, 12).trim();
  if (!/^[0-7]*$/.test(digits)) throw invalid('Not a tar archive');
  return digits === '' ? 0 : Number.parseInt(digits, 8);
}
function checksumValid(header: Uint8Array): boolean {
  let sum = 0;
  for (let index = 0; index < block; index += 1)
    sum += index >= 148 && index < 156 ? 0x20 : (header[index] ?? 0);
  return Number.parseInt(field(header, 148, 8).trim(), 8) === sum;
}
/** `path=` of a pax extended header: records of `<length> <key>=<value>\n`. */
function paxPath(bytes: Uint8Array): string | null {
  const record = text(bytes)
    .split('\n')
    .map((line) => line.slice(line.indexOf(' ') + 1))
    .find((line) => line.startsWith('path='));
  return record === undefined ? null : record.slice(5);
}
/** pacote strips the first directory, so the manifest is `<any>/package.json`. */
const isManifest = (path: string) => /^[^/]+\/package\.json$/.test(path.replace(/^\.\//, ''));

type Capture = {
  kind: 'pax' | 'long' | 'manifest';
  size: number;
  parts: Uint8Array[];
  got: number;
};

/**
 * Walks the entries of a decompressed tar stream until `<dir>/package.json`, skipping data. pax
 * and GNU long names override the next entry's path. Holds at most one header and the manifest.
 */
class TarManifestReader {
  private pending: Buffer = Buffer.alloc(0);
  private skip = 0;
  private capture: Capture | null = null;
  private nextPath: string | null = null;
  manifest: Uint8Array | null = null;
  ended = false;

  push(chunk: Buffer) {
    this.pending = this.pending.length === 0 ? chunk : Buffer.concat([this.pending, chunk]);
    while (!this.ended && this.manifest === null) {
      if (this.skip > 0) {
        const dropped = Math.min(this.skip, this.pending.length);
        this.skip -= dropped;
        this.pending = this.pending.subarray(dropped);
        if (this.skip > 0) return;
      } else if (this.capture) {
        if (!this.take(this.capture)) return;
      } else if (this.pending.length >= block) {
        this.header(this.pending.subarray(0, block));
        this.pending = this.pending.subarray(block);
      } else return;
    }
  }

  private take(capture: Capture): boolean {
    const length = Math.min(capture.size - capture.got, this.pending.length);
    capture.parts.push(this.pending.subarray(0, length));
    capture.got += length;
    this.pending = this.pending.subarray(length);
    if (capture.got < capture.size) return false;
    this.capture = null;
    this.skip = (block - (capture.size % block)) % block;
    const bytes = Buffer.concat(capture.parts);
    if (capture.kind === 'manifest') this.manifest = bytes;
    else this.nextPath = capture.kind === 'pax' ? paxPath(bytes) : field(bytes, 0, bytes.length);
    return true;
  }

  private header(header: Uint8Array) {
    if (header.every((byte) => byte === 0)) {
      this.ended = true;
      return;
    }
    if (!checksumValid(header)) throw invalid('Not a tar archive');
    const size = entrySize(header);
    const type = String.fromCharCode(header[156] ?? 0);
    const prefix = field(header, 257, 6) === 'ustar' ? field(header, 345, 155) : '';
    const name = field(header, 0, 100);
    const path = this.nextPath ?? (prefix ? `${prefix}/${name}` : name);
    const padded = Math.ceil(size / block) * block;
    if ((type === 'x' || type === 'L') && size <= maxNameBytes) {
      this.capture = { kind: type === 'x' ? 'pax' : 'long', size, parts: [], got: 0 };
      return;
    }
    if (type !== 'g') this.nextPath = null;
    if ((type === '0' || type === '\0') && isManifest(path)) {
      if (size > MAX_NPM_MANIFEST_BYTES) throw invalid('package.json is too large');
      this.capture = { kind: 'manifest', size, parts: [], got: 0 };
      if (size === 0) this.take(this.capture);
      return;
    }
    this.skip = padded;
  }
}

/**
 * Facts of an npm tarball (ADR 0066), the same for a publish and for a mirror: its digests over
 * every byte and its package.json. Decompression stops at the manifest, hashing does not; zlib
 * works off the event loop and is fed with backpressure.
 */
export class GzipNpmTarballInspector implements NpmTarballInspector {
  async inspect(source: AsyncIterable<Uint8Array>): Promise<NpmTarballFacts> {
    const hashes = {
      sha1: createHash('sha1'),
      sha256: createHash('sha256'),
      sha512: createHash('sha512'),
    };
    const reader = new TarManifestReader();
    const gunzip = createGunzip();
    let failure: unknown = null;
    gunzip.on('error', (error) => (failure ??= error));
    gunzip.on('data', (chunk: Buffer) => {
      try {
        if (failure === null && reader.manifest === null) reader.push(chunk);
      } catch (error) {
        failure = error;
      }
    });
    let size = 0;
    try {
      for await (const chunk of source) {
        for (const hash of Object.values(hashes)) hash.update(chunk);
        size += chunk.byteLength;
        if (failure !== null || reader.manifest !== null || reader.ended) continue;
        if (!gunzip.write(chunk)) await once(gunzip, 'drain').catch(() => undefined);
      }
      if (failure === null && reader.manifest === null && !reader.ended) {
        gunzip.end();
        await once(gunzip, 'end').catch(() => undefined);
      }
    } finally {
      gunzip.destroy();
    }
    if (failure instanceof ArkvoryError) throw failure;
    if (failure !== null) throw invalid('The tarball is not a gzip-compressed tar archive');
    if (reader.manifest === null) throw invalid('The tarball has no package.json');
    let manifest: unknown;
    try {
      const json = text(reader.manifest);
      // A byte order mark is tolerated, as npm reads such manifests too.
      manifest = JSON.parse(json.charCodeAt(0) === 0xfeff ? json.slice(1) : json);
    } catch {
      throw invalid('package.json is not valid JSON');
    }
    const sha1 = hashes.sha1.digest();
    const sha256 = hashes.sha256.digest();
    const sha512 = hashes.sha512.digest();
    return {
      size,
      manifest,
      sha1: sha1.toString('hex'),
      sha256: sha256.toString('hex'),
      integrity: {
        sha1: sha1.toString('base64'),
        sha256: sha256.toString('base64'),
        sha512: sha512.toString('base64'),
      },
    };
  }
}
