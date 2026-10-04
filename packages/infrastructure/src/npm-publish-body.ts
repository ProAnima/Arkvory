import { ArkvoryError } from '@proanima/arkvory-domain';
import type { Cancellation, NpmPublishStaging } from '@proanima/arkvory-application';
import type { FileRawStaging } from './raw-staging.js';

const quote = 0x22;
const backslash = 0x5c;
const maxKeyBytes = 1024;
/** npm documents nest a few levels; each level costs a frame, so a deep body is refused early. */
const maxDepth = 64;
const base64Text = /^[A-Za-z0-9+/]*$/;

interface Frame {
  readonly array: boolean;
  key: string | null;
  expectKey: boolean;
}
type Mode = 'value' | 'key' | 'string' | 'data';

const invalid = (message: string) => new ArkvoryError('invalid_input', message);

/**
 * Splits an `npm publish` body (ADR 0066) into its JSON document and the tarball inside it
 * without holding the tarball: the string at `_attachments.<file>.data` is base64-decoded while
 * it streams, and the document keeps an empty string in its place. The scanner only follows the
 * structure to find that string; JSON.parse of the document validates everything else. Bytes
 * other than ASCII only occur inside strings, so the scan works on bytes.
 */
export class NpmPublishBody {
  private readonly parts: Uint8Array[] = [];
  private documentBytes = 0;
  private readonly stack: Frame[] = [];
  private mode: Mode = 'value';
  private escaped = false;
  private key: number[] = [];
  private carry = '';
  private padding = 0;
  attachments = 0;

  constructor(private readonly maxDocumentBytes: number) {}

  /** Tarball bytes decoded from this chunk, in order. */
  push(chunk: Uint8Array): Uint8Array[] {
    const out: Uint8Array[] = [];
    let copyFrom = 0;
    let index = 0;
    while (index < chunk.byteLength) {
      if (this.mode === 'data') {
        const end = chunk.indexOf(quote, index);
        const stop = end === -1 ? chunk.byteLength : end;
        const slice = chunk.subarray(index, stop);
        if (slice.includes(backslash)) throw invalid('The tarball data must be plain base64');
        const decoded = this.decode(Buffer.from(slice).toString('latin1'), end !== -1);
        if (decoded.byteLength > 0) out.push(decoded);
        if (end === -1) return out;
        this.mode = 'value';
        copyFrom = end;
        index = end + 1;
        continue;
      }
      const byte = chunk[index] ?? 0;
      if (this.mode !== 'value') this.inString(byte);
      else if (this.structure(byte)) {
        this.keep(chunk.subarray(copyFrom, index + 1));
        copyFrom = index + 1;
      }
      index += 1;
    }
    if (this.mode !== 'data') this.keep(chunk.subarray(copyFrom));
    return out;
  }

  /** The document with the tarball data emptied; throws if the body ended inside a value. */
  document(): unknown {
    if (this.mode !== 'value' || this.stack.length > 0) throw invalid('Malformed JSON body');
    try {
      return JSON.parse(Buffer.concat(this.parts).toString('utf8'));
    } catch {
      throw invalid('Malformed JSON body');
    }
  }

  private keep(bytes: Uint8Array) {
    if (bytes.byteLength === 0) return;
    this.documentBytes += bytes.byteLength;
    if (this.documentBytes > this.maxDocumentBytes)
      throw new ArkvoryError('invalid_input', 'The publish document is too large', {
        reason: 'body_too_large',
      });
    this.parts.push(bytes.slice());
  }

  /** Outside strings. Returns true when the data string starts: the bytes so far are kept. */
  private structure(byte: number): boolean {
    const top = this.stack.at(-1);
    switch (byte) {
      case 0x7b:
      case 0x5b:
        if (this.stack.length >= maxDepth) throw invalid('The publish document nests too deeply');
        this.stack.push({ array: byte === 0x5b, key: null, expectKey: byte === 0x7b });
        return false;
      case 0x7d:
      case 0x5d:
        this.stack.pop();
        return false;
      case 0x2c:
        if (top && !top.array) top.expectKey = true;
        return false;
      case quote:
        if (top && !top.array && top.expectKey) {
          this.mode = 'key';
          this.key = [];
          return false;
        }
        if (this.atData()) {
          this.attachments += 1;
          if (this.attachments > 1) throw invalid('A publish carries exactly one tarball');
          this.mode = 'data';
          this.carry = '';
          this.padding = 0;
          return true;
        }
        this.mode = 'string';
        return false;
      default:
        return false;
    }
  }

  /** Inside a key or value string; keys are collected with their escapes to decode them. */
  private inString(byte: number) {
    const collecting = this.mode === 'key';
    if (this.escaped) this.escaped = false;
    else if (byte === backslash) this.escaped = true;
    else if (byte === quote) {
      if (collecting) this.endKey();
      this.mode = 'value';
      return;
    }
    if (collecting) {
      if (this.key.length >= maxKeyBytes) throw invalid('A key of the document is too long');
      this.key.push(byte);
    }
  }

  private endKey() {
    const top = this.stack.at(-1);
    if (!top) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(`"${Buffer.from(this.key).toString('utf8')}"`);
    } catch {
      throw invalid('Malformed JSON body');
    }
    top.key = typeof parsed === 'string' ? parsed : null;
    top.expectKey = false;
  }

  /** The value being read is `_attachments.<file>.data` of the top-level object. */
  private atData(): boolean {
    const [root, attachments, file] = this.stack;
    return (
      this.stack.length === 3 &&
      root?.array === false &&
      root.key === '_attachments' &&
      attachments?.array === false &&
      file?.array === false &&
      file.key === 'data'
    );
  }

  /**
   * Decodes whole groups of four and keeps the rest for the next chunk; `last` when the string
   * ends here. Padding (at most two `=`) may only end the data, possibly across chunks.
   */
  private decode(text: string, last: boolean): Uint8Array {
    const pad = this.padding > 0 ? 0 : text.indexOf('=');
    const body = pad === -1 ? text : text.slice(0, pad);
    if (!base64Text.test(body)) throw invalid('The tarball data must be plain base64');
    const tail = pad === -1 ? '' : text.slice(pad);
    if (!/^=*$/.test(tail)) throw invalid('Base64 padding inside the data');
    this.padding += tail.length;
    if (this.padding > 2) throw invalid('Base64 padding inside the data');
    const all = this.carry + text;
    if (last && all.length % 4 !== 0) throw invalid('Truncated base64 data');
    const whole = all.length - (all.length % 4);
    this.carry = all.slice(whole);
    return Buffer.from(all.slice(0, whole), 'base64');
  }
}

/** The JSON of a publish without its tarball: manifest, readme and dist-tags. */
const maxDocumentBytes = 8 * 1024 * 1024;

/**
 * Publish bodies staged with the raw-file staging (ADR 0064): the decoded tarball goes to a file
 * there, the rest of the body stays in memory up to 8 MiB. The caller removes the file.
 */
export class FileNpmPublishStaging implements NpmPublishStaging {
  constructor(private readonly staging: FileRawStaging) {}

  async stage(body: AsyncIterable<Uint8Array>, limit: number, cancellation: Cancellation) {
    const split = new NpmPublishBody(maxDocumentBytes);
    async function* tarball() {
      for await (const chunk of body) yield* split.push(chunk);
    }
    const staged = await this.staging.stage(tarball(), limit, cancellation);
    try {
      return { id: staged.id, document: split.document(), attachments: split.attachments };
    } catch (error) {
      await this.staging.remove(staged.id);
      throw error;
    }
  }

  read(id: string): AsyncIterable<Uint8Array> {
    return this.staging.read(id);
  }

  async remove(id: string): Promise<void> {
    await this.staging.remove(id);
  }
}
