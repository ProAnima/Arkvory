import { SigningError } from './errors.js';
import { keyObject, signatureKeyId, verifyMinisign } from './minisign.js';
import type { SigningKey } from './minisign.js';
import type { OperatorKey } from './trust.js';

/**
 * What a key may sign. Each class has its own keys, so the compromise of one key gives no right
 * of another: releases (ADR 0060), ProAnimaStudio modules and revocation lists (ADR 0078, 3.2),
 * licenses (ADR 0078, 6.1) and operator plugins trusted on one host (ADR 0082, section 3).
 */
export const KEY_CLASSES = ['release', 'module', 'license', 'operator'] as const;
export type KeyClass = (typeof KEY_CLASSES)[number];

/**
 * ProAnimaStudio module-signing keys built into the core (ADR 0078, 3.2); separate from the
 * release keys in apps/deploy. Rotation as for releases: core release N carries the old and the
 * new key. The list is empty until the owner creates the first key on the module release
 * workstation (`node scripts/module-signing.mjs keygen module`); until then every module package
 * is refused with `unknown_key`. Tests sign with throwaway keys and pass them explicitly.
 */
export const moduleKeys: readonly SigningKey[] = [];

/**
 * ProAnimaStudio license-signing keys (ADR 0078, 6.1), separate from release and module keys;
 * empty until the owner creates the first one (`keygen license`). Licenses are read from stage O3.
 */
export const licenseKeys: readonly SigningKey[] = [];

/** A trusted key with its class; an operator key carries its entry of the trust list. */
export interface ClassifiedKey extends SigningKey {
  readonly keyClass: KeyClass;
  readonly operator: OperatorKey | null;
}

export interface KeyRingInput {
  readonly release?: readonly SigningKey[];
  readonly module?: readonly SigningKey[];
  readonly license?: readonly SigningKey[];
  readonly operator?: readonly OperatorKey[];
}

/**
 * Every key the caller trusts, each with its class. A key id may appear once across all classes:
 * the signature names only the id, so one id in two classes would make the class ambiguous.
 */
export function keyRing(input: KeyRingInput): readonly ClassifiedKey[] {
  const ring: ClassifiedKey[] = [
    ...(input.release ?? []).map((key) => classified(key, 'release', null)),
    ...(input.module ?? []).map((key) => classified(key, 'module', null)),
    ...(input.license ?? []).map((key) => classified(key, 'license', null)),
    ...(input.operator ?? []).map((entry) =>
      classified({ id: entry.keyId, publicKey: entry.publicKey }, 'operator', entry),
    ),
  ];
  const seen = new Set<string>();
  for (const key of ring) {
    keyObject(key);
    if (seen.has(key.id)) throw new SigningError('duplicate_key', key.id);
    seen.add(key.id);
  }
  return ring;
}

function classified(key: SigningKey, keyClass: KeyClass, operator: OperatorKey | null) {
  return { id: key.id, publicKey: key.publicKey, keyClass, operator };
}

/**
 * Verifies a signature against the ring and requires one of `accepted` classes and the purpose
 * `file:<name>` among the tab-separated fields of the trusted comment, as `minisign -S` writes
 * it. The purpose separates what one key signs: a module key signs both manifests and revocation
 * lists, and neither signature may stand for the other.
 */
export function verifyClassified(
  bytes: Uint8Array,
  signature: string,
  ring: readonly ClassifiedKey[],
  accepted: readonly KeyClass[],
  purpose: string,
): ClassifiedKey {
  const keyId = signatureKeyId(signature);
  const key = ring.find((candidate) => candidate.id === keyId);
  if (!key) throw new SigningError('unknown_key', keyId);
  const { trustedComment } = verifyMinisign(bytes, signature, [key]);
  // Checked after the signature: a forged signature naming a key of another class is invalid.
  if (!accepted.includes(key.keyClass)) throw new SigningError('wrong_key_class', keyId);
  if (!trustedComment.split('\t').includes(`file:${purpose}`))
    throw new SigningError('signature_purpose', keyId);
  return key;
}
