import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { BackupFailure } from '@proanima/arkvory-domain';

/*
 * File encryption of an encrypted vault (ADR 0070): AES-256-GCM in the STREAM construction.
 *
 *   header (44 bytes)  "ARKVGCM1" | log2 chunk size (1) | 3 zero bytes | salt (32)
 *   chunk              ciphertext of up to 1 MiB | tag (16)
 *
 * The key of a file is HKDF-SHA256(master key, salt, vault | kind | name), so a file moved to
 * another name, point or vault fails authentication, and a key is never used for two files.
 * The nonce is the chunk number (8 bytes), three zero bytes and a flag that marks the last chunk:
 * a truncated or extended file and reordered chunks fail too. The header is authenticated data of
 * every chunk. Only the standard primitives of node:crypto are used.
 */

const MAGIC = Buffer.from('ARKVGCM1');
export const HEADER_BYTES = 44;
const SALT_BYTES = 32;
const TAG_BYTES = 16;
const CHUNK_LOG2 = 20;
export const CHUNK_BYTES = 2 ** CHUNK_LOG2;
const FRAME_BYTES = CHUNK_BYTES + TAG_BYTES;

/** What a vault file holds; part of its key, so a file of one kind never opens as another. */
export type VaultFileKind = 'blob' | 'table' | 'inventory' | 'manifest' | 'scratch';

/** Size on disk of an encrypted file of `plain` bytes: the header, the content and one tag per chunk. */
export function encryptedSize(plain: number): number {
  return HEADER_BYTES + plain + TAG_BYTES * Math.max(1, Math.ceil(plain / CHUNK_BYTES));
}

/** Encryption of one vault file (a fixed kind and name). */
export interface FileCipher {
  encrypt(source: AsyncIterable<Uint8Array>): AsyncIterable<Uint8Array>;
  /** Plain content of the encrypted stream; authentication is checked chunk by chunk. */
  decrypt(source: AsyncIterable<Uint8Array>): AsyncIterable<Uint8Array>;
  /** A whole small file at once (manifests). */
  decryptBuffer(data: Uint8Array): Buffer;
  encryptedSize(plain: number): number;
}

function corrupt(message: string): BackupFailure {
  return new BackupFailure('integrity_mismatch', message);
}

function nonce(index: number, last: boolean): Buffer {
  const value = Buffer.alloc(12);
  value.writeBigUInt64BE(BigInt(index), 0);
  value[11] = last ? 1 : 0;
  return value;
}

function open(key: Buffer, header: Buffer, index: number, last: boolean, frame: Buffer): Buffer {
  const text = frame.subarray(0, frame.length - TAG_BYTES);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, nonce(index, last), {
      authTagLength: TAG_BYTES,
    });
    decipher.setAAD(header);
    decipher.setAuthTag(frame.subarray(frame.length - TAG_BYTES));
    return Buffer.concat([decipher.update(text), decipher.final()]);
  } catch (error) {
    // Wrong key, damaged bytes, another file, a cut or extended file: all the same to a reader.
    throw new BackupFailure('integrity_mismatch', 'Vault file failed authentication', {
      cause: error,
    });
  }
}

function seal(key: Buffer, header: Buffer, index: number, last: boolean, text: Buffer): Buffer[] {
  const cipher = createCipheriv('aes-256-gcm', key, nonce(index, last), {
    authTagLength: TAG_BYTES,
  });
  cipher.setAAD(header);
  const encrypted = Buffer.concat([cipher.update(text), cipher.final()]);
  return [encrypted, cipher.getAuthTag()];
}

function parseHeader(header: Buffer): Buffer {
  if (!header.subarray(0, MAGIC.length).equals(MAGIC) || header[8] !== CHUNK_LOG2)
    throw corrupt('Not a file of an encrypted vault');
  if (header[9] !== 0 || header[10] !== 0 || header[11] !== 0) throw corrupt('Unsupported header');
  return header.subarray(12, 12 + SALT_BYTES);
}

/**
 * Bytes taken from the front of a queue of pieces; the rest stays queued. A head index instead of
 * shift() keeps taking linear even when a source delivers many tiny pieces.
 */
class Pieces {
  private list: Buffer[] = [];
  private head = 0;
  private offset = 0;
  length = 0;

  add(piece: Uint8Array): void {
    if (piece.byteLength === 0) return;
    this.list.push(Buffer.from(piece.buffer, piece.byteOffset, piece.byteLength));
    this.length += piece.byteLength;
  }

  take(count: number): Buffer {
    const parts: Buffer[] = [];
    let need = count;
    while (need > 0) {
      const current = this.list[this.head];
      if (current === undefined) throw corrupt('Vault file is truncated');
      const available = current.length - this.offset;
      if (available <= need) {
        parts.push(this.offset === 0 ? current : current.subarray(this.offset));
        need -= available;
        this.head++;
        this.offset = 0;
      } else {
        parts.push(current.subarray(this.offset, this.offset + need));
        this.offset += need;
        need = 0;
      }
    }
    this.length -= count;
    if (this.head > 1024 && this.head * 2 > this.list.length) {
      this.list = this.list.slice(this.head);
      this.head = 0;
    }
    return parts.length === 1 && parts[0] ? parts[0] : Buffer.concat(parts);
  }
}

/** The encryption of a vault: the master key and the identity that every file key is bound to. */
export class VaultCipher {
  constructor(
    private readonly masterKey: Buffer,
    readonly vaultId: string,
  ) {
    if (masterKey.length !== 32) throw new BackupFailure('unexpected', 'Invalid master key');
  }

  /** A copy of the master key, for wrapping it into a new key slot (key administration only). */
  slotMaster(): Buffer {
    return Buffer.from(this.masterKey);
  }

  private fileKey(salt: Buffer, kind: VaultFileKind, name: string): Buffer {
    const info = Buffer.from(`arkvory-vault-v1/file|${this.vaultId}|${kind}|${name}`);
    return Buffer.from(hkdfSync('sha256', this.masterKey, salt, info, 32));
  }

  private async *encryptFile(
    kind: VaultFileKind,
    name: string,
    source: AsyncIterable<Uint8Array>,
  ): AsyncIterable<Uint8Array> {
    const salt = randomBytes(SALT_BYTES);
    const header = Buffer.concat([MAGIC, Buffer.from([CHUNK_LOG2, 0, 0, 0]), salt]);
    const key = this.fileKey(salt, kind, name);
    yield header;
    const current = Buffer.allocUnsafe(CHUNK_BYTES);
    let filled = 0;
    let index = 0;
    for await (const piece of source) {
      const bytes = Buffer.from(piece.buffer, piece.byteOffset, piece.byteLength);
      for (let offset = 0; offset < bytes.length;) {
        // A full chunk is sealed only when more data follows: the last one carries the flag.
        if (filled === CHUNK_BYTES) {
          yield* seal(key, header, index++, false, current.subarray(0, filled));
          filled = 0;
        }
        const count = Math.min(CHUNK_BYTES - filled, bytes.length - offset);
        bytes.copy(current, filled, offset, offset + count);
        filled += count;
        offset += count;
      }
    }
    yield* seal(key, header, index, true, current.subarray(0, filled));
  }

  private async *decryptFile(
    kind: VaultFileKind,
    name: string,
    source: AsyncIterable<Uint8Array>,
  ): AsyncIterable<Uint8Array> {
    const pieces = new Pieces();
    let opened: { readonly header: Buffer; readonly key: Buffer } | undefined;
    let index = 0;
    for await (const piece of source) {
      pieces.add(piece);
      if (opened === undefined) {
        if (pieces.length < HEADER_BYTES) continue;
        const header = pieces.take(HEADER_BYTES);
        opened = { header, key: this.fileKey(parseHeader(header), kind, name) };
      }
      // More than one frame buffered: the first one cannot be the last one.
      while (pieces.length > FRAME_BYTES)
        yield open(opened.key, opened.header, index++, false, pieces.take(FRAME_BYTES));
    }
    if (opened === undefined || pieces.length < TAG_BYTES) throw corrupt('Vault file is truncated');
    yield open(opened.key, opened.header, index, true, pieces.take(pieces.length));
  }

  private decryptWhole(kind: VaultFileKind, name: string, data: Uint8Array): Buffer {
    const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    if (bytes.length < HEADER_BYTES + TAG_BYTES) throw corrupt('Vault file is truncated');
    const header = bytes.subarray(0, HEADER_BYTES);
    const key = this.fileKey(parseHeader(header), kind, name);
    const parts: Buffer[] = [];
    let offset = HEADER_BYTES;
    for (let index = 0; ; index++) {
      const rest = bytes.length - offset;
      const last = rest <= FRAME_BYTES;
      const frame = bytes.subarray(offset, offset + Math.min(rest, FRAME_BYTES));
      parts.push(open(key, header, index, last, frame));
      offset += frame.length;
      if (last) return Buffer.concat(parts);
    }
  }

  forFile(kind: VaultFileKind, name: string): FileCipher {
    return {
      encryptedSize,
      encrypt: (source) => this.encryptFile(kind, name, source),
      decrypt: (source) => this.decryptFile(kind, name, source),
      decryptBuffer: (data) => this.decryptWhole(kind, name, data),
    };
  }
}
