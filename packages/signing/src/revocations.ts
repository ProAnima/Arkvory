import { MODULE_ID_PATTERN, parseSemanticVersion } from '@proanima/arkvory-extension-api';
import { SigningError } from './errors.js';
import { verifyClassified } from './keys.js';
import type { ClassifiedKey } from './keys.js';
import { utcTime } from './trust.js';

/** The purpose in the trusted comment and the name of the file a list is stored and shipped as. */
export const REVOCATIONS_FILE = 'module-revocations.json';
const MAX_ENVELOPE = 1024 * 1024;
const MAX_ENTRIES = 4096;
const REASON = /^[a-z][a-z0-9_]{0,63}$/;
const DAY = 24 * 60 * 60 * 1000;

/**
 * Signed validity of a list (ADR 0078, 3.4): the signing tool gives 90 days unless the payload
 * names `expiresAt`, and no list is valid for more than 180 days. The bound is what an attacker
 * who controls delivery (a hub channel, a mirror) can freeze a host at: after it, installs and
 * pins of that host stop until a current list arrives.
 */
export const REVOCATION_VALIDITY_DAYS = { default: 90, maximum: 180 } as const;

/** One revoked module and its versions (ADR 0078, 3.4). */
export interface RevocationEntry {
  readonly id: string;
  /** Exact semver versions. */
  readonly versions: readonly string[];
  /** Machine code of the reason. */
  readonly reason: string;
  /** True: the read path of the version still serves reads, export and evacuation. */
  readonly readOnly: boolean;
  /** The version that replaces the revoked ones, or null. */
  readonly replacement: string | null;
}

/** A verified revocation list with the exact envelope it was read from, to store it unchanged. */
export interface RevocationList {
  readonly sequence: number;
  readonly issuedAt: string;
  /** Signed; after it the list still revokes, but no longer makes installs current. */
  readonly expiresAt: string;
  readonly entries: readonly RevocationEntry[];
  readonly keyId: string;
  /** The signed payload, base64url, as the envelope carries it. */
  readonly payload: string;
  readonly envelope: string;
}

type Row = Readonly<Record<string, unknown>>;

function row(value: unknown, path: string, fields: readonly string[]): Row {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new SigningError('revocations_invalid', path);
  const entries = Object.fromEntries(Object.entries(value));
  const unknown = Object.keys(entries).find((key) => !fields.includes(key));
  if (unknown !== undefined) throw new SigningError('revocations_invalid', `${path}/${unknown}`);
  return entries;
}

function version(value: unknown, path: string): string {
  if (typeof value !== 'string' || parseSemanticVersion(value) === null)
    throw new SigningError('revocations_invalid', path);
  return value;
}

function entry(value: unknown, path: string): RevocationEntry {
  const item = row(value, path, ['id', 'versions', 'reason', 'readOnly', 'replacement']);
  const id = item['id'];
  if (typeof id !== 'string' || !MODULE_ID_PATTERN.test(id))
    throw new SigningError('revocations_invalid', `${path}/id`);
  const versions = item['versions'];
  if (!Array.isArray(versions) || versions.length < 1 || versions.length > 256)
    throw new SigningError('revocations_invalid', `${path}/versions`);
  const reason = item['reason'];
  if (typeof reason !== 'string' || !REASON.test(reason))
    throw new SigningError('revocations_invalid', `${path}/reason`);
  if (typeof item['readOnly'] !== 'boolean')
    throw new SigningError('revocations_invalid', `${path}/readOnly`);
  return {
    id,
    versions: versions.map((v: unknown, index) => version(v, `${path}/versions/${String(index)}`)),
    reason,
    readOnly: item['readOnly'],
    replacement:
      item['replacement'] === null ? null : version(item['replacement'], `${path}/replacement`),
  };
}

function payload(bytes: Buffer): Omit<RevocationList, 'keyId' | 'payload' | 'envelope'> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new SigningError('revocations_invalid', '', { cause: error });
  }
  const list = row(parsed, '', ['format', 'sequence', 'issuedAt', 'expiresAt', 'entries']);
  if (list['format'] !== 1) throw new SigningError('revocations_invalid', '/format');
  const sequence = list['sequence'];
  if (typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || sequence < 1)
    throw new SigningError('revocations_invalid', '/sequence');
  const entries = list['entries'];
  if (!Array.isArray(entries) || entries.length > MAX_ENTRIES)
    throw new SigningError('revocations_invalid', '/entries');
  const issuedAt = utcTimeOf(list['issuedAt'], '/issuedAt');
  const expiresAt = utcTimeOf(list['expiresAt'], '/expiresAt');
  const validity = Date.parse(expiresAt) - Date.parse(issuedAt);
  if (validity <= 0 || validity > REVOCATION_VALIDITY_DAYS.maximum * DAY)
    throw new SigningError('revocations_invalid', '/expiresAt');
  return {
    sequence,
    issuedAt,
    expiresAt,
    entries: entries.map((item: unknown, index) => entry(item, `/entries/${String(index)}`)),
  };
}

function utcTimeOf(value: unknown, path: '/issuedAt' | '/expiresAt'): string {
  try {
    return utcTime(value, path);
  } catch (error) {
    throw new SigningError('revocations_invalid', path, { cause: error });
  }
}

/**
 * Reads a signed revocation list: `{"format": 1, "payload": "<base64url>", "signature":
 * "<minisign>"}`. The signature covers the exact payload bytes, so no JSON canonicalization is
 * needed. Only a ProAnimaStudio module key with the purpose `file:module-revocations.json`
 * signs a list; the payload is then read as untrusted input.
 */
export function readRevocations(envelope: string, ring: readonly ClassifiedKey[]): RevocationList {
  if (envelope.length > MAX_ENVELOPE) throw new SigningError('revocations_invalid', '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(envelope);
  } catch (error) {
    throw new SigningError('revocations_invalid', '', { cause: error });
  }
  const outer = row(parsed, '', ['format', 'payload', 'signature']);
  const encoded = outer['payload'];
  const signature = outer['signature'];
  if (outer['format'] !== 1) throw new SigningError('revocations_invalid', '/format');
  if (typeof encoded !== 'string' || !/^[A-Za-z0-9_-]*$/.test(encoded))
    throw new SigningError('revocations_invalid', '/payload');
  const bytes = Buffer.from(encoded, 'base64url');
  // One spelling per payload: lists of one sequence are compared by this text, and set filler
  // bits or a dangling character would make the same signed list look like a conflicting one.
  if (bytes.toString('base64url') !== encoded)
    throw new SigningError('revocations_invalid', '/payload');
  if (typeof signature !== 'string') throw new SigningError('revocations_invalid', '/signature');
  const key = verifyClassified(bytes, signature, ring, ['module'], REVOCATIONS_FILE);
  return { ...payload(bytes), keyId: key.id, payload: encoded, envelope };
}

/** The envelope text of a signed payload, for the signing tool. */
export function revocationsEnvelope(payloadBytes: Uint8Array, signature: string): string {
  const text = JSON.stringify({
    format: 1,
    payload: Buffer.from(payloadBytes).toString('base64url'),
    signature,
  });
  return `${text}\n`;
}

/**
 * Whether `candidate` replaces `stored`. A lower sequence is a rollback and is refused, so an
 * old list cannot bring back a revoked version; the same sequence is accepted only with the
 * same payload (a different one means a signing defect, never a choice). Expiry plays no part:
 * an expired list with a higher sequence still carries the newest revocations and replaces the
 * stored one; it only does not make installs current (`revocationsCurrent`).
 */
export function acceptRevocations(
  stored: RevocationList | null,
  candidate: RevocationList,
): 'accepted' | 'unchanged' {
  if (stored === null || candidate.sequence > stored.sequence) return 'accepted';
  if (candidate.sequence < stored.sequence)
    throw new SigningError('revocation_rollback', String(candidate.sequence));
  if (candidate.payload !== stored.payload)
    throw new SigningError('revocation_conflict', String(candidate.sequence));
  return 'unchanged';
}

/** The newer of two verified lists without refusing either: for lists shipped in packages. */
export function newerRevocations(
  a: RevocationList | null,
  b: RevocationList | null,
): RevocationList | null {
  if (a === null) return b;
  if (b === null) return a;
  return b.sequence > a.sequence ? b : a;
}

/** The entry that revokes `id@version`, or null. */
export function revocationOf(
  list: RevocationList | null,
  id: string,
  moduleVersion: string,
): RevocationEntry | null {
  return list?.entries.find((e) => e.id === id && e.versions.includes(moduleVersion)) ?? null;
}

/**
 * Whether `list` is current at `now` (milliseconds): installs and pins need one. A stale or
 * missing list never stops installed modules; only an entry of the list does.
 */
export function revocationsCurrent(list: RevocationList | null, now: number): boolean {
  return list !== null && Date.parse(list.expiresAt) > now;
}
