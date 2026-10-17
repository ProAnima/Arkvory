import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { SigningError } from './errors.js';

/** An Ed25519 public key in minisign terms: the key id and the raw public key. */
export interface SigningKey {
  /** 8 bytes as 16 hex digits, in the order minisign stores them. */
  readonly id: string;
  /** 32 bytes, base64. */
  readonly publicKey: string;
}

/** What a valid signature proves besides the bytes: the key and the signed trusted comment. */
export interface VerifiedSignature {
  readonly keyId: string;
  readonly trustedComment: string;
  /** `ED`: BLAKE2b-512 prehashed (minisign's default); `Ed`: the legacy signature of the bytes. */
  readonly algorithm: 'ED' | 'Ed';
}

const KEY_ID = /^[0-9a-f]{16}$/;
const prehashed = Buffer.from('ED');
const legacy = Buffer.from('Ed');

/** The Ed25519 key object of a minisign key; a malformed key is refused, never guessed. */
export function keyObject(key: SigningKey): KeyObject {
  const raw = Buffer.from(key.publicKey, 'base64');
  if (raw.length !== 32 || raw.toString('base64') !== key.publicKey || !KEY_ID.test(key.id))
    throw new SigningError('key_invalid');
  return createPublicKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: raw.toString('base64url') },
    format: 'jwk',
  });
}

interface SignatureParts {
  readonly algorithm: Buffer;
  readonly keyId: string;
  readonly value: Buffer;
  readonly trustedComment: string;
  readonly global: Buffer;
}

/**
 * Standard base64 in its one canonical spelling. Node's decoder skips unknown characters and
 * accepts missing padding and set filler bits, so one signature would have many texts.
 */
function canonicalBase64(line: string): Buffer {
  const bytes = Buffer.from(line, 'base64');
  if (bytes.toString('base64') !== line) throw new SigningError('signature_malformed');
  return bytes;
}

function parts(signature: string): SignatureParts {
  const lines = signature.replace(/\r\n/g, '\n').trimEnd().split('\n');
  const trusted = lines[2] ?? '';
  if (lines.length !== 4 || !lines[0]?.startsWith('untrusted comment: '))
    throw new SigningError('signature_malformed');
  if (!trusted.startsWith('trusted comment: ')) throw new SigningError('signature_malformed');
  const body = canonicalBase64(lines[1] ?? '');
  const global = canonicalBase64(lines[3] ?? '');
  if (body.length !== 74 || global.length !== 64) throw new SigningError('signature_malformed');
  return {
    algorithm: body.subarray(0, 2),
    keyId: body.subarray(2, 10).toString('hex'),
    value: body.subarray(10),
    trustedComment: trusted.slice('trusted comment: '.length),
    global,
  };
}

/** The key id a signature names, before any key is trusted; a malformed signature throws. */
export function signatureKeyId(signature: string): string {
  return parts(signature).keyId;
}

/**
 * Verifies a minisign signature (the format of `minisign -V` and of Tauri's `latest.json`): the
 * Ed25519 signature of the bytes (BLAKE2b-512 prehashed for `ED`, the bytes themselves for the
 * legacy `Ed`) and the global signature over it and the trusted comment. Only `keys` are trusted;
 * any failure throws a SigningError: `signature_malformed`, `unknown_key` or `signature_invalid`.
 */
export function verifyMinisign(
  bytes: Uint8Array,
  signature: string,
  keys: readonly SigningKey[],
): VerifiedSignature {
  const { algorithm, keyId, value, trustedComment, global } = parts(signature);
  const key = keys.find((candidate) => candidate.id === keyId);
  if (!key) throw new SigningError('unknown_key', keyId);
  const message = algorithm.equals(prehashed)
    ? createHash('blake2b512').update(bytes).digest()
    : algorithm.equals(legacy)
      ? Buffer.from(bytes)
      : null;
  const trusted = keyObject(key);
  if (
    !message ||
    !verify(null, message, trusted, value) ||
    !verify(null, Buffer.concat([value, Buffer.from(trustedComment)]), trusted, global)
  )
    throw new SigningError('signature_invalid', keyId);
  return { keyId, trustedComment, algorithm: algorithm.equals(prehashed) ? 'ED' : 'Ed' };
}

/**
 * Signs `bytes` as `minisign -S` does (prehashed). For signing tools and tests only: no process of
 * an installation holds a private key.
 */
export function signMinisign(
  bytes: Uint8Array,
  privateKeyPem: string,
  id: string,
  trustedComment: string,
  untrustedComment: string,
): string {
  if (!KEY_ID.test(id) || /[\r\n]/.test(trustedComment) || /[\r\n]/.test(untrustedComment))
    throw new SigningError('key_invalid');
  const key = createPrivateKey(privateKeyPem);
  const value = sign(null, createHash('blake2b512').update(bytes).digest(), key);
  const global = sign(null, Buffer.concat([value, Buffer.from(trustedComment)]), key);
  const body = Buffer.concat([prehashed, Buffer.from(id, 'hex'), value]);
  return [
    `untrusted comment: ${untrustedComment}`,
    body.toString('base64'),
    `trusted comment: ${trustedComment}`,
    global.toString('base64'),
    '',
  ].join('\n');
}

/** The raw public key of a PKCS#8 Ed25519 private key, base64. */
export function publicKeyOf(privateKeyPem: string): string {
  const jwk = createPublicKey(createPrivateKey(privateKeyPem)).export({ format: 'jwk' });
  if (jwk.crv !== 'Ed25519' || typeof jwk.x !== 'string') throw new SigningError('key_invalid');
  return Buffer.from(jwk.x, 'base64url').toString('base64');
}

/**
 * Reads a minisign public key: the text of a `.pub` file (an untrusted comment line, then the
 * key line) or the key line alone. The key line is base64 of `Ed`, the 8-byte key id and the
 * 32-byte public key.
 */
export function parseMinisignPublicKey(text: string): SigningKey {
  if (text.length > 4096) throw new SigningError('key_invalid');
  const lines = text.replace(/\r\n/g, '\n').trim().split('\n');
  if (lines.length === 2 && !lines[0]?.startsWith('untrusted comment: '))
    throw new SigningError('key_invalid');
  if (lines.length !== 1 && lines.length !== 2) throw new SigningError('key_invalid');
  const line = lines[lines.length - 1] ?? '';
  const raw = Buffer.from(line, 'base64');
  if (raw.length !== 42 || raw.toString('base64') !== line || !raw.subarray(0, 2).equals(legacy))
    throw new SigningError('key_invalid');
  const key = {
    id: raw.subarray(2, 10).toString('hex'),
    publicKey: raw.subarray(10).toString('base64'),
  };
  keyObject(key);
  return key;
}

/** The `.pub` file text of a key, as `minisign -G` writes it. */
export function minisignPublicKeyText(key: SigningKey, comment: string): string {
  keyObject(key);
  if (/[\r\n]/.test(comment)) throw new SigningError('key_invalid');
  const line = Buffer.concat([
    legacy,
    Buffer.from(key.id, 'hex'),
    Buffer.from(key.publicKey, 'base64'),
  ]).toString('base64');
  return `untrusted comment: ${comment}\n${line}\n`;
}

/** SHA-256 of the raw public key, hex in groups of four: what an operator compares by voice. */
export function keyFingerprint(key: SigningKey): string {
  const digest = createHash('sha256').update(Buffer.from(key.publicKey, 'base64')).digest('hex');
  return digest.match(/.{4}/g)?.join(' ') ?? digest;
}
