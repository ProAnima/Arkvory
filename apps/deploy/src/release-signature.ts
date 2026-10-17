import { SigningError, publicKeyOf, signMinisign, verifyMinisign } from '@proanima/arkvory-signing';
import type { SigningKey } from '@proanima/arkvory-signing';

/** A release signing key built into the updater: minisign key id and raw Ed25519 public key. */
export type ReleaseKey = SigningKey;

const messages: Readonly<Partial<Record<SigningError['code'], string>>> = {
  signature_malformed: 'Invalid release signature',
  unknown_key: 'Release is signed with an unknown key',
  signature_invalid: 'Release signature is not valid',
  key_invalid: 'Invalid release key',
};

/**
 * Verifies a minisign signature of a release manifest (ADR 0060) with the verification of
 * packages/signing: the Ed25519 signature of the file and the global signature over it and the
 * trusted comment. Only the built-in keys are trusted; any failure throws with the messages the
 * updater has always shown.
 */
export function verifyReleaseSignature(
  bytes: Uint8Array,
  signature: string,
  keys: readonly ReleaseKey[],
): void {
  try {
    verifyMinisign(bytes, signature, keys);
  } catch (error) {
    const message = error instanceof SigningError ? messages[error.code] : undefined;
    if (message !== undefined) throw new Error(message, { cause: error });
    throw error;
  }
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
  return signMinisign(
    bytes,
    privateKeyPem,
    id,
    comment,
    `signature from ProAnima Arkvory release key ${id}`,
  );
}

/** The raw public key of a PKCS#8 Ed25519 private key, base64. */
export function releasePublicKey(privateKeyPem: string): string {
  try {
    return publicKeyOf(privateKeyPem);
  } catch (error) {
    if (error instanceof SigningError) throw new Error('Not an Ed25519 key', { cause: error });
    throw error;
  }
}
