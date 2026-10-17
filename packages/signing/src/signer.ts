import { SigningError } from './errors.js';
import type { ClassifiedKey } from './keys.js';
import type { PackageManifest } from './package-manifest.js';
import { OPERATOR_ID_PATTERN, operatorKeyExpired, pluginPatternCovers } from './trust.js';

/** The publisher of ProAnimaStudio modules; only the built-in module keys sign it. */
export const PROANIMASTUDIO = 'proanimastudio';

/** The trust tier a package was accepted at, by the key that signed it (ADR 0082, section 1). */
export interface PackageSigner {
  readonly source: 'signed' | 'operator';
  readonly keyId: string;
  /** The operator's label of the key; null for ProAnimaStudio keys. */
  readonly label: string | null;
  /** An operator key past `expiresAt`: refused for installation, a warning for a loaded package. */
  readonly expired: boolean;
}

/**
 * Why a package is checked: `install` refuses an expired operator key, `load` (the check when a
 * process starts and when packages are listed) reports it, so installed plugins keep working
 * until the operator decides (ADR 0082, section 3).
 */
export type SignerPurpose = 'install' | 'load';

/**
 * The tier follows the key, never a field of the manifest: `publisher` and the id namespace are
 * only checked against it. ProAnimaStudio keys sign `publisher: "proanimastudio"` outside `op-`;
 * an operator key signs only `op-` ids its patterns cover, never that publisher, a license
 * feature or the `license` service. A release or license key never signs a module.
 */
export function packageSigner(
  key: ClassifiedKey,
  manifest: PackageManifest,
  now: number,
  purpose: SignerPurpose,
): PackageSigner {
  const { id, publisher, uses } = manifest.module;
  if (key.keyClass === 'module') {
    if (publisher !== PROANIMASTUDIO) throw new SigningError('publisher_mismatch', id);
    if (id.startsWith('op-')) throw new SigningError('namespace_mismatch', id);
    return { source: 'signed', keyId: key.id, label: null, expired: false };
  }
  const operator = key.operator;
  if (key.keyClass !== 'operator' || operator === null)
    throw new SigningError('wrong_key_class', key.id);
  if (!OPERATOR_ID_PATTERN.test(id)) throw new SigningError('namespace_mismatch', id);
  if (publisher === PROANIMASTUDIO) throw new SigningError('publisher_mismatch', id);
  if (manifest.package.licenseFeature !== null || uses.includes('license'))
    throw new SigningError('license_feature_forbidden', id);
  if (!operator.plugins.some((pattern) => pluginPatternCovers(pattern, id)))
    throw new SigningError('signer_scope', id);
  const expired = operatorKeyExpired(operator, now);
  if (expired && purpose === 'install') throw new SigningError('signer_expired', key.id);
  return { source: 'operator', keyId: key.id, label: operator.label, expired };
}
