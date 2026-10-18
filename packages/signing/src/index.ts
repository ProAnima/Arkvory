export { SIGNING_PROBLEMS, SigningError, type SigningProblem } from './errors.js';
export {
  keyFingerprint,
  keyObject,
  minisignPublicKeyText,
  parseMinisignPublicKey,
  publicKeyOf,
  signMinisign,
  signatureKeyId,
  verifyMinisign,
  type SigningKey,
  type VerifiedSignature,
} from './minisign.js';
export {
  KEY_CLASSES,
  keyRing,
  licenseKeys,
  moduleKeys,
  verifyClassified,
  type ClassifiedKey,
  type KeyClass,
  type KeyRingInput,
} from './keys.js';
export {
  MAX_TRUSTED_KEYS,
  OPERATOR_ID_PATTERN,
  PLUGIN_TRUST_FILE,
  operatorKeyExpired,
  parsePluginTrust,
  pluginPattern,
  pluginPatternCovers,
  utcTime,
  type OperatorKey,
  type PluginTrust,
} from './trust.js';
export {
  REVOCATIONS_FILE,
  REVOCATION_VALIDITY_DAYS,
  acceptRevocations,
  newerRevocations,
  readRevocations,
  revocationOf,
  revocationsCurrent,
  revocationsEnvelope,
  type RevocationEntry,
  type RevocationList,
} from './revocations.js';
export {
  CLIENT_ENTRY,
  DATA_CLASSES,
  PACKAGE_LIMITS,
  PACKAGE_SIDES,
  checkCompatibility,
  parseModuleFields,
  parsePackageManifest,
  type PackageEntryRole,
  type PackageSide,
  type CompatibilityHost,
  type DataClass,
  type PackageFields,
  type PackageFile,
  type PackageManifest,
} from './package-manifest.js';
export { FILES_DIRECTORY, MANIFEST_FILE, SIGNATURE_FILE, safePath } from './package-paths.js';
export { PROANIMASTUDIO, type PackageSigner, type SignerPurpose } from './signer.js';
export type { PackageHost, SignedManifest } from './package-verify.js';
export {
  TERMS_FILE,
  extractModulePackage,
  inspectModulePackage,
  type InspectedPackage,
} from './package-archive.js';
export { verifyInstalledModule } from './package-installed.js';
export {
  MODULE_SET_FILE,
  parseModuleSet,
  parseRetained,
  type InstalledModule,
  type ModuleSet,
  type RetainedPackage,
} from './module-set.js';
