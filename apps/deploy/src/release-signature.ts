import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import type { KeyObject } from 'node:crypto';

/** A release signing key built into the updater: minisign key id and raw Ed25519 public key. */
export interface ReleaseKey {
  /** 8 bytes as 16 hex digits, in the order minisign stores them. */
  readonly id: string;
  /** 32 bytes, base64. */
  readonly publicKey: string;
}

const prehashed = Buffer.from('ED');
const legacy = Buffer.from('Ed');

function publicKey(key: ReleaseKey): KeyObject {
  const raw = Buffer.from(key.publicKey, 'base64');
  if (raw.length !== 32 || !/^[0-9a-f]{16}$/.test(key.id)) throw new Error('Invalid release key');
  return createPublicKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: raw.toString('base64url') },
    format: 'jwk',
  });
}

function lines(signature: string): [Buffer, string, Buffer] {
  const parts = signature.replace(/\r\n/g, '\n').trimEnd().split('\n');
  const trusted = parts[2] ?? '';
  if (parts.length !== 4 || !parts[0]?.startsWith('untrusted comment: '))
    throw new Error('Invalid release signature');
  if (!trusted.startsWith('trusted comment: ')) throw new Error('Invalid release signature');
  const body = Buffer.from(parts[1] ?? '', 'base64');
  const global = Buffer.from(parts[3] ?? '', 'base64');
  if (body.length !== 74 || global.length !== 64) throw new Error('Invalid release signature');
  return [body, trusted.slice('trusted comment: '.length), global];
}

/**
 * Verifies a minisign signature (the format of Tauri's `latest.json` and `minisign -V`): the
 * Ed25519 signature of the file (BLAKE2b-512 prehashed for `ED`) and the global signature over
 * it and the trusted comment. Only the built-in keys are trusted; any failure throws.
 */
export function verifyReleaseSignature(
  bytes: Uint8Array,
  signature: string,
  keys: readonly ReleaseKey[],
): void {
  const [body, comment, global] = lines(signature);
  const algorithm = body.subarray(0, 2);
  const id = body.subarray(2, 10).toString('hex');
  const value = body.subarray(10);
  const key = keys.find((candidate) => candidate.id === id);
  if (!key) throw new Error('Release is signed with an unknown key');
  const message = algorithm.equals(prehashed)
    ? createHash('blake2b512').update(bytes).digest()
    : algorithm.equals(legacy)
      ? Buffer.from(bytes)
      : null;
  const trusted = publicKey(key);
  if (
    !message ||
    !verify(null, message, trusted, value) ||
    !verify(null, Buffer.concat([value, Buffer.from(comment)]), trusted, global)
  )
    throw new Error('Release signature is not valid');
}

/** Signs `bytes` as `minisign -S` does (prehashed); used by the release tooling only. */
export function signRelease(
  bytes: Uint8Array,
  privateKeyPem: string,
  id: string,
  comment: string,
): string {
  if (!/^[0-9a-f]{16}$/.test(id) || /[\r\n]/.test(comment))
    throw new Error('Invalid signing input');
  const key = createPrivateKey(privateKeyPem);
  const value = sign(null, createHash('blake2b512').update(bytes).digest(), key);
  const global = sign(null, Buffer.concat([value, Buffer.from(comment)]), key);
  const body = Buffer.concat([prehashed, Buffer.from(id, 'hex'), value]);
  return [
    `untrusted comment: signature from ProAnima Arkvory release key ${id}`,
    body.toString('base64'),
    `trusted comment: ${comment}`,
    global.toString('base64'),
    '',
  ].join('\n');
}

/** The raw public key of a PKCS#8 Ed25519 private key, base64. */
export function releasePublicKey(privateKeyPem: string): string {
  const jwk = createPublicKey(createPrivateKey(privateKeyPem)).export({ format: 'jwk' });
  if (typeof jwk.x !== 'string') throw new Error('Not an Ed25519 key');
  return Buffer.from(jwk.x, 'base64url').toString('base64');
}
