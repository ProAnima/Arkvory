/**
 * Machine codes of every refusal of this package. A code says what failed; the subject, when
 * there is one, is a key id, a module id or a package path that already passed its own pattern,
 * never raw untrusted text.
 */
export const SIGNING_PROBLEMS = [
  // Signatures and keys.
  'signature_malformed',
  'unknown_key',
  'signature_invalid',
  'signature_purpose',
  'signature_algorithm',
  'wrong_key_class',
  'key_invalid',
  'duplicate_key',
  // Signer rules by trust tier (ADR 0082, section 1).
  'signer_expired',
  'signer_scope',
  'publisher_mismatch',
  'namespace_mismatch',
  'license_feature_forbidden',
  // Operator trust list and revocation list.
  'trust_invalid',
  'revocations_invalid',
  'revocation_rollback',
  'revocation_conflict',
  // Package archive and installed directory.
  'archive_invalid',
  'archive_too_large',
  'entry_too_large',
  'too_many_entries',
  'unsafe_path',
  'link_entry',
  'special_entry',
  'extended_header',
  'duplicate_entry',
  'case_collision',
  'unexpected_entry',
  'native_addon',
  'manifest_missing',
  'signature_missing',
  'manifest_invalid',
  'module_incompatible',
  'file_missing',
  'file_unlisted',
  'file_mismatch',
  'package_changed',
] as const;
export type SigningProblem = (typeof SIGNING_PROBLEMS)[number];

/** A refused signature, key, list or package. */
export class SigningError extends Error {
  override readonly name = 'SigningError';
  constructor(
    readonly code: SigningProblem,
    /** A validated key id, module id, JSON Pointer or package path; null when none applies. */
    readonly subject: string | null = null,
    options?: ErrorOptions,
  ) {
    super(
      subject === null
        ? `Signing check failed: ${code}`
        : `Signing check failed: ${code} (${subject})`,
      options,
    );
  }
}
