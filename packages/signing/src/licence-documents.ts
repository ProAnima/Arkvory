import { keyObject } from './minisign.js';
import type { SigningKey } from './minisign.js';
import {
  LICENCE_FORMAT,
  LICENCE_PRODUCT,
  LicenceDocumentError,
  closedRow,
  field,
  nullableField,
  parseLicenceEnvelope,
  payloadRow,
  signedPayload,
} from './licence-envelope.js';
import type { LicenceEnvelope, LicenceProblem, Row } from './licence-envelope.js';
import {
  DAY_MS,
  activationId,
  decimalLimit,
  installationId,
  keyIdOf,
  licenceId,
  licenceName,
  licenceNonce,
  licenceTime,
  licenceType,
  licenseeName,
  reasonCode,
  tokenId,
  watermark,
  wholeNumber,
} from './licence-values.js';

/**
 * Purposes in the trusted comment by kind. `offline-activation` is provisional: the hub defines
 * it in its stage H2 and its vectors do not cover it yet (ADR 0078, implementation notes O3).
 */
export const LICENCE_PURPOSES = {
  delegation: 'licence-delegation',
  activation: 'licence-activation',
  revocation: 'licence-revocation',
  'revocation-list': 'licence-revocation-list',
  'offline-activation': 'licence-offline-activation',
} as const;
/** What a delegated key may sign. */
export const DELEGATED_KINDS = ['activation', 'revocation', 'offline-activation'] as const;
export type DelegatedKind = (typeof DELEGATED_KINDS)[number];
/** Revocation reasons of a statement. */
export const REVOCATION_REASONS = [
  'licence_revoked',
  'activation_revoked',
  'activation_released',
] as const;
/** The longest offline window of a token: online activations, trials and offline files. */
export const TOKEN_WINDOW_DAYS = { online: 90, trial: 7, offline: 365 } as const;

/** A delegation certificate of the root: the key, what it may sign and when. */
export interface LicenceCertificate {
  readonly keyId: string;
  readonly publicKey: string;
  readonly purposes: readonly DelegatedKind[];
  readonly notBefore: string;
  readonly notAfter: string;
  readonly maxTokenDays: number;
}

/** An activation token (`activation`) or an offline activation file (`offline-activation`). */
export interface ActivationToken {
  readonly kind: 'activation' | 'offline-activation';
  readonly tokenId: string;
  readonly licenceId: string;
  readonly activationId: string;
  readonly type: string;
  readonly licensee: string;
  readonly installation: string;
  readonly features: readonly string[];
  /** Decimal strings of unsigned 64-bit values. */
  readonly limits: Readonly<Record<string, string>>;
  readonly issuedAt: string;
  readonly refreshAfter: string;
  readonly notAfter: string;
  readonly licenceNotAfter: string | null;
  readonly graceDays: number;
  readonly updatesUntil: string | null;
  readonly seq: number;
  readonly nonce: string;
  /** The hub's watermark of the issue; never logged. */
  readonly wm: string;
  readonly keyId: string;
}

/** A signed statement that a licence or one activation is revoked. */
export interface RevocationStatement {
  readonly licenceId: string;
  readonly activationId: string;
  readonly installation: string;
  readonly reason: (typeof REVOCATION_REASONS)[number];
  readonly revokedAt: string;
  readonly issuedAt: string;
  readonly seq: number;
  readonly nonce: string;
  readonly keyId: string;
}

/** A licence revocation list signed by the root. */
export interface LicenceRevocationList {
  readonly number: number;
  readonly issuedAt: string;
  readonly licences: readonly { readonly licenceId: string; readonly reason: string }[];
  /** Key ids of delegated keys whose documents are no longer accepted. */
  readonly certificates: readonly string[];
}

/** A verified document with the exact text it was read from (kept as evidence). */
export interface VerifiedLicenceDocument<T> {
  readonly document: T;
  readonly certificate: LicenceCertificate | null;
  readonly text: string;
}

/** Milliseconds of a time this module already checked. */
const ms = (time: string) => licenceTime(time) ?? Number.NaN;
const isoOf = (value: unknown) => (licenceTime(value) === null ? null : String(value));
const chain = (code: LicenceProblem, subject: string | null = null) =>
  new LicenceDocumentError('chain', code, subject);
const malformed = (code: LicenceProblem, subject: string | null = null) =>
  new LicenceDocumentError('malformed', code, subject);

function head(row: Row, kind: string) {
  if (row['format'] !== LICENCE_FORMAT) throw malformed('payload_invalid', '/format');
  if (row['kind'] !== kind) throw malformed('payload_invalid', '/kind');
  if (row['product'] !== LICENCE_PRODUCT) throw malformed('payload_invalid', '/product');
}

const listOf =
  <T>(read: (value: unknown) => T | null, maximum: number, minimum = 0) =>
  (value: unknown): T[] | null => {
    if (!Array.isArray(value) || value.length < minimum || value.length > maximum) return null;
    const items = value.map((item: unknown) => read(item));
    return items.every((item): item is T => item !== null) ? items : null;
  };
const delegatedKind = (value: unknown) => DELEGATED_KINDS.find((kind) => kind === value) ?? null;

function limitsOf(value: unknown): Record<string, string> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > 256) return null;
  const limits: [string, string][] = [];
  for (const [key, text] of entries) {
    const name = licenceName(key);
    const limit = decimalLimit(text);
    if (name === null || limit === null) return null;
    limits.push([name, limit]);
  }
  return Object.fromEntries(limits);
}

const DELEGATION_FIELDS = [
  'format',
  'kind',
  'product',
  'keyId',
  'publicKey',
  'purposes',
  'notBefore',
  'notAfter',
  'maxTokenDays',
];

/** A delegation certificate signed by one of `roots` directly (its own chain is empty). */
export function verifyLicenceCertificate(
  document: LicenceEnvelope,
  roots: readonly SigningKey[],
): LicenceCertificate {
  if (document.chain.length !== 0) throw chain('chain_not_direct');
  const row = payloadRow(signedPayload(document, roots, LICENCE_PURPOSES.delegation), [
    ...DELEGATION_FIELDS,
  ]);
  head(row, 'delegation');
  const keyId = field(row, 'keyId', keyIdOf);
  const publicKey = field(row, 'publicKey', (value) => (typeof value === 'string' ? value : null));
  try {
    keyObject({ id: keyId, publicKey });
  } catch (error) {
    throw new LicenceDocumentError('malformed', 'payload_invalid', '/publicKey', { cause: error });
  }
  if (roots.some((root) => root.id === keyId || root.publicKey === publicKey))
    throw chain('chain_self', keyId);
  const purposes = field(row, 'purposes', listOf(delegatedKind, 3, 1));
  const notBefore = field(row, 'notBefore', licenceTime);
  const notAfter = field(row, 'notAfter', licenceTime);
  if (notAfter <= notBefore) throw malformed('payload_invalid', '/notAfter');
  const maxTokenDays = field(row, 'maxTokenDays', (v) => wholeNumber(v, 1, 365));
  return {
    keyId,
    publicKey,
    purposes,
    notBefore: String(row['notBefore']),
    notAfter: String(row['notAfter']),
    maxTokenDays,
  };
}

interface Delegated {
  readonly row: Row;
  readonly certificate: LicenceCertificate;
  readonly issuedAt: number;
}

/**
 * A document signed by a delegated key: exactly one certificate from a root that allows `kind`,
 * the signature of its key for the kind's purpose, `keyId` naming that key and `issuedAt` in the
 * certificate's window. Fields are read before the window, so a wrong field is `malformed`.
 */
function verifyDelegated(
  text: string,
  roots: readonly SigningKey[],
  kind: DelegatedKind,
  fields: readonly string[],
  readFields: (row: Row) => void,
): Delegated {
  const document = parseLicenceEnvelope(text);
  const [entry, ...extra] = document.chain;
  if (entry === undefined || extra.length > 0) throw chain('chain_length');
  const certificate = verifyLicenceCertificate(entry, roots);
  if (!certificate.purposes.includes(kind)) throw chain('chain_kind', certificate.keyId);
  const key = { id: certificate.keyId, publicKey: certificate.publicKey };
  const row = payloadRow(signedPayload(document, [key], LICENCE_PURPOSES[kind]), fields);
  head(row, kind);
  readFields(row);
  if (row['keyId'] !== certificate.keyId) throw malformed('key_mismatch', certificate.keyId);
  const issuedAt = field(row, 'issuedAt', licenceTime);
  if (issuedAt < ms(certificate.notBefore) || issuedAt >= ms(certificate.notAfter))
    throw chain('chain_window', certificate.keyId);
  return { row, certificate, issuedAt };
}

const TOKEN_FIELDS = [
  'format',
  'kind',
  'product',
  'tokenId',
  'licenceId',
  'activationId',
  'type',
  'licensee',
  'installation',
  'features',
  'limits',
  'issuedAt',
  'refreshAfter',
  'notAfter',
  'licenceNotAfter',
  'graceDays',
  'updatesUntil',
  'seq',
  'nonce',
  'wm',
  'keyId',
];

function tokenOf(row: Row, kind: ActivationToken['kind']): ActivationToken {
  return {
    kind,
    tokenId: field(row, 'tokenId', tokenId),
    licenceId: field(row, 'licenceId', licenceId),
    activationId: field(row, 'activationId', activationId),
    type: field(row, 'type', licenceType),
    licensee: field(row, 'licensee', licenseeName),
    installation: field(row, 'installation', installationId),
    features: field(row, 'features', listOf(licenceName, 256)),
    limits: field(row, 'limits', limitsOf),
    issuedAt: field(row, 'issuedAt', isoOf),
    refreshAfter: field(row, 'refreshAfter', isoOf),
    notAfter: field(row, 'notAfter', isoOf),
    licenceNotAfter: nullableField(row, 'licenceNotAfter', isoOf),
    graceDays: field(row, 'graceDays', (v) => wholeNumber(v, 0, 90)),
    updatesUntil: nullableField(row, 'updatesUntil', isoOf),
    seq: field(row, 'seq', (v) => wholeNumber(v, 1, Number.MAX_SAFE_INTEGER)),
    nonce: field(row, 'nonce', licenceNonce),
    wm: field(row, 'wm', watermark),
    keyId: field(row, 'keyId', keyIdOf),
  };
}

/**
 * Bounds of a token's times (ADR 0078, R2, "Срок токена"): `maxTokenDays` of the certificate is
 * a `chain` failure, as in the hub; the rest is `out_of_bounds`. `notAfter` is never past the
 * licence's end with its grace, nor past the longest offline window of the kind and type; a
 * trial has no renewal grace.
 */
function checkTokenTimes(token: ActivationToken, certificate: LicenceCertificate) {
  const issued = ms(token.issuedAt);
  const notAfter = ms(token.notAfter);
  if (notAfter < issued || notAfter - issued > certificate.maxTokenDays * DAY_MS)
    throw chain('chain_token_days', certificate.keyId);
  const refresh = ms(token.refreshAfter);
  if (refresh < issued || refresh > notAfter) throw malformed('out_of_bounds', '/refreshAfter');
  const trial = token.type === 'trial';
  const days =
    token.kind === 'offline-activation'
      ? TOKEN_WINDOW_DAYS.offline
      : trial
        ? TOKEN_WINDOW_DAYS.trial
        : TOKEN_WINDOW_DAYS.online;
  if (notAfter - issued > days * DAY_MS) throw malformed('out_of_bounds', '/notAfter');
  if (trial && token.graceDays !== 0) throw malformed('out_of_bounds', '/graceDays');
  if (
    token.licenceNotAfter !== null &&
    notAfter > ms(token.licenceNotAfter) + token.graceDays * DAY_MS
  )
    throw malformed('out_of_bounds', '/notAfter');
}

function verifyToken(
  text: string,
  roots: readonly SigningKey[],
  kind: ActivationToken['kind'],
): VerifiedLicenceDocument<ActivationToken> {
  let token: ActivationToken | undefined;
  const { certificate } = verifyDelegated(text, roots, kind, TOKEN_FIELDS, (row) => {
    token = tokenOf(row, kind);
  });
  if (token === undefined) throw malformed('payload_invalid');
  checkTokenTimes(token, certificate);
  return { document: token, certificate, text };
}

/**
 * An activation token as the hub sends it, checked as far as a document alone allows. The
 * installation's own checks (its id, the pending nonce, `seq` above the kept one, effective time)
 * belong to the caller.
 */
export function verifyActivationToken(text: string, roots: readonly SigningKey[]) {
  return verifyToken(text, roots, 'activation');
}

/** An offline activation file (provisional until the hub's stage H2; see LICENCE_PURPOSES). */
export function verifyOfflineActivation(text: string, roots: readonly SigningKey[]) {
  return verifyToken(text, roots, 'offline-activation');
}

const REVOCATION_FIELDS = [
  'format',
  'kind',
  'product',
  'licenceId',
  'activationId',
  'installation',
  'reason',
  'revokedAt',
  'issuedAt',
  'seq',
  'nonce',
  'keyId',
];

/** A revocation statement; as with tokens, nonce and seq are the caller's to compare. */
export function verifyRevocationStatement(
  text: string,
  roots: readonly SigningKey[],
): VerifiedLicenceDocument<RevocationStatement> {
  let statement: RevocationStatement | undefined;
  const { certificate } = verifyDelegated(text, roots, 'revocation', REVOCATION_FIELDS, (row) => {
    statement = {
      licenceId: field(row, 'licenceId', licenceId),
      activationId: field(row, 'activationId', activationId),
      installation: field(row, 'installation', installationId),
      reason: field(row, 'reason', (v) => REVOCATION_REASONS.find((r) => r === v) ?? null),
      revokedAt: field(row, 'revokedAt', isoOf),
      issuedAt: field(row, 'issuedAt', isoOf),
      seq: field(row, 'seq', (v) => wholeNumber(v, 1, Number.MAX_SAFE_INTEGER)),
      nonce: field(row, 'nonce', licenceNonce),
      keyId: field(row, 'keyId', keyIdOf),
    };
  });
  if (statement === undefined) throw malformed('payload_invalid');
  return { document: statement, certificate, text };
}

const LIST_FIELDS = ['format', 'kind', 'product', 'number', 'issuedAt', 'licences', 'certificates'];

/** A licence revocation list signed by the root directly; a lower number is the caller's to refuse. */
export function verifyLicenceRevocationList(
  text: string,
  roots: readonly SigningKey[],
): VerifiedLicenceDocument<LicenceRevocationList> {
  const document = parseLicenceEnvelope(text);
  if (document.chain.length !== 0) throw chain('chain_not_direct');
  const row = payloadRow(
    signedPayload(document, roots, LICENCE_PURPOSES['revocation-list']),
    LIST_FIELDS,
  );
  head(row, 'revocation-list');
  const entry = (value: unknown) => {
    const item = closedRow(value, ['licenceId', 'reason'], '/licences');
    return {
      licenceId: field(item, 'licenceId', licenceId),
      reason: field(item, 'reason', reasonCode),
    };
  };
  return {
    document: {
      number: field(row, 'number', (v) => wholeNumber(v, 1, Number.MAX_SAFE_INTEGER)),
      issuedAt: field(row, 'issuedAt', isoOf),
      licences: field(row, 'licences', listOf(entry, 100000)),
      certificates: field(row, 'certificates', listOf(keyIdOf, 4096)),
    },
    certificate: null,
    text,
  };
}
