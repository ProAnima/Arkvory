import {
  LicenceDocumentError,
  licenceDocumentKind,
  licenceTime,
  licenseKeys,
  verifyActivationToken,
  verifyLicenceRevocationList,
  verifyOfflineActivation,
  verifyRevocationStatement,
} from '@proanima/arkvory-signing';
import type { SigningKey } from '@proanima/arkvory-signing';
import { LicenceDocumentRefused } from '@proanima/arkvory-application';
import type {
  LicenceVerifier,
  VerifiedLicenceRevocation,
  VerifiedLicenceToken,
  VerifiedRevocationList,
} from '@proanima/arkvory-application';

const ms = (time: string) => licenceTime(time) ?? Number.NaN;

function refusal<T>(read: () => T): T {
  try {
    return read();
  } catch (error) {
    if (error instanceof LicenceDocumentError)
      throw new LicenceDocumentRefused(error.failure, error.code);
    throw error;
  }
}

/**
 * Licence documents checked with the licence root built into the core (`licenseKeys`), or the
 * roots a test passes. Signature, chain and payload rules live in `packages/signing`; this
 * adapter only maps them to the use cases' facts.
 */
export function licenceVerifier(roots: readonly SigningKey[] = licenseKeys): LicenceVerifier {
  return {
    token(text, kind): VerifiedLicenceToken {
      const { document, certificate } = refusal(() =>
        kind === 'activation'
          ? verifyActivationToken(text, roots)
          : verifyOfflineActivation(text, roots),
      );
      return {
        kind,
        licenceId: document.licenceId,
        activationId: document.activationId,
        installation: document.installation,
        type: document.type,
        licensee: document.licensee,
        features: document.features,
        limits: document.limits,
        issuedAt: ms(document.issuedAt),
        refreshAfter: ms(document.refreshAfter),
        notAfter: ms(document.notAfter),
        licenceNotAfter: document.licenceNotAfter === null ? null : ms(document.licenceNotAfter),
        graceDays: document.graceDays,
        updatesUntil: document.updatesUntil === null ? null : ms(document.updatesUntil),
        seq: document.seq,
        nonce: document.nonce,
        signer: certificate?.keyId ?? document.keyId,
      };
    },
    revocation(text): VerifiedLicenceRevocation {
      const { document } = refusal(() => verifyRevocationStatement(text, roots));
      return {
        licenceId: document.licenceId,
        activationId: document.activationId,
        installation: document.installation,
        reason: document.reason,
        issuedAt: ms(document.issuedAt),
        seq: document.seq,
        nonce: document.nonce,
      };
    },
    revocationList(text): VerifiedRevocationList {
      const { document } = refusal(() => verifyLicenceRevocationList(text, roots));
      return {
        number: document.number,
        licences: new Map(document.licences.map((entry) => [entry.licenceId, entry.reason])),
        certificates: new Set(document.certificates),
      };
    },
    kind: licenceDocumentKind,
  };
}
