import { SigningError } from './errors.js';
import { verifyMinisign } from './minisign.js';
import type { SigningKey } from './minisign.js';
import { strictJson } from './licence-json.js';

/**
 * The envelope of licence documents (ADR 0078, R2; the hub's `docs/licence-format.md`):
 * `{"format": 2, "payload": "<base64url>", "signature": "<minisign>", "chain": [<envelope>]}`.
 * The signature covers the exact payload bytes, so no canonical JSON is needed; the payload is
 * read as untrusted input only after its signature verified.
 */
export const LICENCE_FORMAT = 2;
export const LICENCE_PRODUCT = 'arkvory';
/** The longest document read (a revocation list grows with revocations). */
export const MAX_LICENCE_DOCUMENT = 1024 * 1024;

/**
 * The three classes of a refusal the hub's golden vectors name: `signature` (malformed or
 * invalid signature, unknown key, wrong algorithm or purpose), `chain` (missing or extra
 * certificate, not from a root, kind not allowed, outside the window, longer than
 * `maxTokenDays`) and `malformed` (anything else about the envelope or payload).
 */
export type LicenceFailure = 'signature' | 'chain' | 'malformed';

export const LICENCE_PROBLEMS = [
  'signature_malformed',
  'unknown_key',
  'signature_invalid',
  'signature_purpose',
  'signature_algorithm',
  'key_invalid',
  'chain_length',
  'chain_not_direct',
  'chain_self',
  'chain_kind',
  'chain_window',
  'chain_token_days',
  'document_too_large',
  'envelope_invalid',
  'payload_invalid',
  'key_mismatch',
  'out_of_bounds',
] as const;
export type LicenceProblem = (typeof LICENCE_PROBLEMS)[number];

/** A refused licence document: its class, a machine code and a JSON Pointer or key id. */
export class LicenceDocumentError extends Error {
  override readonly name = 'LicenceDocumentError';
  constructor(
    readonly failure: LicenceFailure,
    readonly code: LicenceProblem,
    /** A JSON Pointer into the payload or a validated key id; never raw untrusted text. */
    readonly subject: string | null = null,
    options?: ErrorOptions,
  ) {
    super(
      `Licence document refused: ${failure}/${code}${subject === null ? '' : ` (${subject})`}`,
      options,
    );
  }
}

export interface LicenceEnvelope {
  readonly format: typeof LICENCE_FORMAT;
  readonly payload: string;
  readonly signature: string;
  readonly chain: readonly LicenceEnvelope[];
}

export type Row = Readonly<Record<string, unknown>>;

const malformed = (code: LicenceProblem, subject: string | null = null) =>
  new LicenceDocumentError('malformed', code, subject);

function objectOf(value: unknown): Row | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return Object.fromEntries(Object.entries(value));
}

/** An object with exactly `fields`; the first missing or unknown field is the subject. */
export function closedRow(value: unknown, fields: readonly string[], path = ''): Row {
  const row = objectOf(value);
  if (row === null) throw malformed('payload_invalid', path);
  const unknown = Object.keys(row).find((key) => !fields.includes(key));
  if (unknown !== undefined) throw malformed('payload_invalid', `${path}/${unknown}`);
  const missing = fields.find((field) => !(field in row));
  if (missing !== undefined) throw malformed('payload_invalid', `${path}/${missing}`);
  return row;
}

/** The checked value of a field, or `malformed` naming the field. */
export function field<T>(row: Row, name: string, read: (value: unknown) => T | null, path = ''): T {
  const value = read(row[name]);
  if (value === null) throw malformed('payload_invalid', `${path}/${name}`);
  return value;
}

/** `null`, or the checked value of a field such as `licenceNotAfter`. */
export function nullableField<T>(row: Row, name: string, read: (value: unknown) => T | null) {
  return row[name] === null ? null : field(row, name, read);
}

function envelope(value: unknown): LicenceEnvelope {
  const row = objectOf(value);
  if (row === null) throw malformed('envelope_invalid');
  const keys = Object.keys(row).sort().join(',');
  if (keys !== 'chain,format,payload,signature') throw malformed('envelope_invalid');
  const { format, payload, signature, chain } = row;
  if (format !== LICENCE_FORMAT) throw malformed('envelope_invalid', '/format');
  // base64url without padding in its one spelling: Node's decoder skips stray characters.
  if (
    typeof payload !== 'string' ||
    !/^[A-Za-z0-9_-]*$/.test(payload) ||
    Buffer.from(payload, 'base64url').toString('base64url') !== payload
  )
    throw malformed('envelope_invalid', '/payload');
  if (typeof signature !== 'string') throw malformed('envelope_invalid', '/signature');
  if (!Array.isArray(chain)) throw malformed('envelope_invalid', '/chain');
  return { format, payload, signature, chain: chain.map((entry: unknown) => envelope(entry)) };
}

/** Parses an envelope text: the four fields once each, `format` 2, at most 1 MiB. */
export function parseLicenceEnvelope(text: string): LicenceEnvelope {
  if (Buffer.byteLength(text, 'utf8') > MAX_LICENCE_DOCUMENT) throw malformed('document_too_large');
  let parsed: unknown;
  try {
    parsed = strictJson(text);
  } catch (error) {
    throw new LicenceDocumentError('malformed', 'envelope_invalid', null, { cause: error });
  }
  return envelope(parsed);
}

/**
 * The payload bytes after their signature by one of `keys` for `purpose`: only the prehashed
 * `ED` algorithm (the legacy `Ed` would let an `ED` signature of X stand for BLAKE2b(X)), and
 * `file:<purpose>` among the tab-separated fields of the trusted comment, checked after the
 * signature so that a forged comment is reported as an invalid signature.
 */
export function signedPayload(
  document: LicenceEnvelope,
  keys: readonly SigningKey[],
  purpose: string,
): Buffer {
  const bytes = Buffer.from(document.payload, 'base64url');
  let verified;
  try {
    verified = verifyMinisign(bytes, document.signature, keys);
  } catch (error) {
    if (!(error instanceof SigningError)) throw error;
    const code = LICENCE_PROBLEMS.find((known) => known === error.code) ?? 'signature_invalid';
    throw new LicenceDocumentError('signature', code, error.subject, { cause: error });
  }
  if (verified.algorithm !== 'ED')
    throw new LicenceDocumentError('signature', 'signature_algorithm', verified.keyId);
  if (!verified.trustedComment.split('\t').includes(`file:${purpose}`))
    throw new LicenceDocumentError('signature', 'signature_purpose', verified.keyId);
  return bytes;
}

/** The payload object of verified bytes with exactly `fields`. */
export function payloadRow(bytes: Buffer, fields: readonly string[]): Row {
  let parsed: unknown;
  try {
    parsed = strictJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    throw new LicenceDocumentError('malformed', 'payload_invalid', '', { cause: error });
  }
  return closedRow(parsed, fields);
}

/** The untrusted `kind` of a document's payload, only to choose its verifier; null if none. */
export function licenceDocumentKind(text: string): string | null {
  try {
    const bytes = Buffer.from(parseLicenceEnvelope(text).payload, 'base64url');
    const kind = objectOf(strictJson(bytes.toString('utf8')))?.['kind'];
    return typeof kind === 'string' ? kind : null;
  } catch {
    return null;
  }
}
