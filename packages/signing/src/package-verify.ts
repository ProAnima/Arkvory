import { SigningError } from './errors.js';
import { verifyClassified } from './keys.js';
import type { ClassifiedKey } from './keys.js';
import { checkCompatibility, parsePackageManifest } from './package-manifest.js';
import type { CompatibilityHost, PackageFile, PackageManifest } from './package-manifest.js';
import { MANIFEST_FILE } from './package-paths.js';
import { packageSigner } from './signer.js';
import type { PackageSigner, SignerPurpose } from './signer.js';

/** The core that installs or loads a package: its keys, versions and clock. */
export interface PackageHost extends CompatibilityHost {
  /** Keys of every class the host knows; only module and operator keys sign packages. */
  readonly keys: readonly ClassifiedKey[];
  /** Milliseconds since the epoch, for the expiry of operator keys. */
  readonly now: number;
}

/** A package whose signature, manifest and signer passed; files are compared separately. */
export interface SignedManifest {
  readonly manifest: PackageManifest;
  readonly signer: PackageSigner;
}

const utf8 = new TextDecoder('utf-8', { fatal: true });

/**
 * Steps 1 and 2 of ADR 0078, 3.3: the signature of the exact `module.json` bytes by a module or
 * operator key with the purpose `file:module.json`, then the manifest read as untrusted input,
 * then the tier rules of the signing key. Nothing of the manifest is trusted before the
 * signature is.
 */
export function verifySignedManifest(
  manifestBytes: Buffer,
  signature: Buffer,
  host: PackageHost,
  purpose: SignerPurpose,
): SignedManifest {
  let signatureText: string;
  try {
    signatureText = utf8.decode(signature);
  } catch (error) {
    throw new SigningError('signature_malformed', null, { cause: error });
  }
  const key = verifyClassified(
    manifestBytes,
    signatureText,
    host.keys,
    ['module', 'operator'],
    MANIFEST_FILE,
  );
  let input: unknown;
  try {
    input = JSON.parse(utf8.decode(manifestBytes));
  } catch (error) {
    throw new SigningError('manifest_invalid', '', { cause: error });
  }
  const manifest = parsePackageManifest(input);
  return { manifest, signer: packageSigner(key, manifest, host.now, purpose) };
}

/** What one file of the package holds, as read. */
export interface ReadFile {
  readonly size: number;
  readonly sha256: string;
}

/**
 * Step 3: every listed file exists with its exact size and SHA-256, and no other file exists.
 * Then the extension API and core release ranges (step 4): a well-formed package of another
 * contract version is incompatible, not damaged.
 */
export function compareFiles(
  signed: SignedManifest,
  found: ReadonlyMap<string, ReadFile>,
  host: PackageHost,
): void {
  const listed = new Map<string, PackageFile>(
    signed.manifest.package.files.map((file) => [file.path, file]),
  );
  for (const [path, file] of listed) {
    const actual = found.get(path);
    if (actual === undefined) throw new SigningError('file_missing', path);
    if (actual.size !== file.size || actual.sha256 !== file.sha256)
      throw new SigningError('file_mismatch', path);
  }
  for (const path of found.keys())
    if (!listed.has(path)) throw new SigningError('file_unlisted', path);
  checkCompatibility(signed.manifest, host);
}
