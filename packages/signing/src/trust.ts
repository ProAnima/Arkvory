import { SigningError } from './errors.js';
import { keyObject } from './minisign.js';

/** One key of an author the operator trusts on this host (ADR 0082, section 3). */
export interface OperatorKey {
  readonly keyId: string;
  /** Raw Ed25519 public key, base64. */
  readonly publicKey: string;
  readonly label: string;
  /** Ids the key may sign: exact `op-…` ids or prefixes ending with `*`, such as `op-acme-*`. */
  readonly plugins: readonly string[];
  readonly allowInProcess: boolean;
  /** ISO 8601 UTC times. */
  readonly addedAt: string;
  readonly addedBy: string;
  /** No new installation is accepted at or after this time; null for no limit. */
  readonly expiresAt: string | null;
}

/** `config/plugin-trust.json`: kept by host commands only, read by the services. */
export interface PluginTrust {
  readonly format: 1;
  readonly keys: readonly OperatorKey[];
}

export const PLUGIN_TRUST_FILE = 'plugin-trust.json';
export const MAX_TRUSTED_KEYS = 256;

/**
 * Id of an operator plugin: `op-` and 2 to 21 characters, as extension-api requires of the
 * sources `operator` and `development`, without doubled or trailing hyphens.
 */
export const OPERATOR_ID_PATTERN = /^op-(?=[a-z0-9-]{2,21}$)[a-z](?:-?[a-z0-9])+$/;
const PREFIX_PATTERN = /^op-(?:[a-z][a-z0-9-]{0,20})?$/;
const KEY_ID = /^[0-9a-f]{16}$/;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const LABEL = /^[^\p{Cc}]{1,128}$/u;
const FIELDS = [
  'keyId',
  'publicKey',
  'label',
  'plugins',
  'allowInProcess',
  'addedAt',
  'addedBy',
  'expiresAt',
];

type Row = Readonly<Record<string, unknown>>;

function row(value: unknown, path: string): Row {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new SigningError('trust_invalid', path);
  return Object.fromEntries(Object.entries(value));
}

function text(value: unknown, path: string, pattern: RegExp): string {
  if (typeof value !== 'string' || !pattern.test(value))
    throw new SigningError('trust_invalid', path);
  return value;
}

/** An ISO 8601 UTC time that names a real instant. */
export function utcTime(value: unknown, path: string): string {
  const time = text(value, path, TIME);
  if (!Number.isFinite(Date.parse(time))) throw new SigningError('trust_invalid', path);
  return time;
}

/** Whether `pattern` (an exact id or a prefix ending with `*`) covers the plugin id. */
export function pluginPatternCovers(pattern: string, id: string): boolean {
  return pattern.endsWith('*') ? id.startsWith(pattern.slice(0, -1)) : pattern === id;
}

/** Validates a pattern of `--plugins`; the same rule the trust list is read with. */
export function pluginPattern(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new SigningError('trust_invalid', path);
  const valid = value.endsWith('*')
    ? PREFIX_PATTERN.test(value.slice(0, -1))
    : OPERATOR_ID_PATTERN.test(value);
  if (!valid) throw new SigningError('trust_invalid', path);
  return value;
}

function operatorKey(value: unknown, path: string): OperatorKey {
  const entry = row(value, path);
  const unknown = Object.keys(entry).find((key) => !FIELDS.includes(key));
  if (unknown !== undefined) throw new SigningError('trust_invalid', `${path}/${unknown}`);
  const plugins = entry['plugins'];
  if (!Array.isArray(plugins) || plugins.length < 1 || plugins.length > 32)
    throw new SigningError('trust_invalid', `${path}/plugins`);
  const patterns = plugins.map((item: unknown, index) =>
    pluginPattern(item, `${path}/plugins/${String(index)}`),
  );
  if (new Set(patterns).size !== patterns.length)
    throw new SigningError('trust_invalid', `${path}/plugins`);
  if (typeof entry['allowInProcess'] !== 'boolean')
    throw new SigningError('trust_invalid', `${path}/allowInProcess`);
  const key: OperatorKey = {
    keyId: text(entry['keyId'], `${path}/keyId`, KEY_ID),
    publicKey: text(entry['publicKey'], `${path}/publicKey`, /^[A-Za-z0-9+/]{43}=$/),
    label: text(entry['label'], `${path}/label`, LABEL),
    plugins: patterns,
    allowInProcess: entry['allowInProcess'],
    addedAt: utcTime(entry['addedAt'], `${path}/addedAt`),
    addedBy: text(entry['addedBy'], `${path}/addedBy`, LABEL),
    expiresAt:
      entry['expiresAt'] === null ? null : utcTime(entry['expiresAt'], `${path}/expiresAt`),
  };
  try {
    keyObject({ id: key.keyId, publicKey: key.publicKey });
  } catch (error) {
    throw new SigningError('trust_invalid', `${path}/publicKey`, { cause: error });
  }
  return key;
}

/**
 * Reads the trust list as untrusted input: unknown fields, wrong types, malformed keys, patterns
 * outside `op-` and duplicate key ids are refused with the JSON Pointer of the field.
 */
export function parsePluginTrust(input: unknown): PluginTrust {
  const value = row(input, '');
  const unknown = Object.keys(value).find((key) => key !== 'format' && key !== 'keys');
  if (unknown !== undefined) throw new SigningError('trust_invalid', `/${unknown}`);
  if (value['format'] !== 1) throw new SigningError('trust_invalid', '/format');
  const keys = value['keys'];
  if (!Array.isArray(keys) || keys.length > MAX_TRUSTED_KEYS)
    throw new SigningError('trust_invalid', '/keys');
  const parsed = keys.map((entry: unknown, index) => operatorKey(entry, `/keys/${String(index)}`));
  const ids = new Set<string>();
  parsed.forEach((key, index) => {
    if (ids.has(key.keyId)) throw new SigningError('trust_invalid', `/keys/${String(index)}/keyId`);
    ids.add(key.keyId);
  });
  return { format: 1, keys: parsed };
}

/** Whether an operator key no longer accepts new installations at `now` (milliseconds). */
export function operatorKeyExpired(key: OperatorKey, now: number): boolean {
  return key.expiresAt !== null && Date.parse(key.expiresAt) <= now;
}
