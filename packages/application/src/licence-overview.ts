import { licenceClockRolledBack, licenceStatus } from '@proanima/arkvory-domain';
import type { LicenceState, LicenceStatus } from '@proanima/arkvory-domain';
import { effectiveNow } from './licence-exchange.js';
import { LicenceDocumentRefused } from './licence-ports.js';
import type {
  LicenceStore,
  LicenceVerifier,
  StoredActivation,
  VerifiedLicenceToken,
  VerifiedRevocationList,
} from './licence-ports.js';

/**
 * What the installation knows about its licences, judged at effective time: for `arkvory license
 * status`, `GET /api/v1/system/license` and the `license` service of modules. Every stored
 * document is verified again here, so a row changed in the database is `invalid`, never trusted.
 * Nothing here contacts the hub.
 */
export interface LicenceSummary {
  readonly activationId: string;
  readonly licenceId: string;
  readonly licensee: string | null;
  readonly licenseType: string | null;
  readonly activation: 'online' | 'offline';
  readonly features: readonly string[];
  readonly limits: Readonly<Record<string, string>>;
  readonly issuedAt: number | null;
  readonly updatesUntil: number | null;
  readonly lastRefreshAt: number | null;
  readonly nextAttemptAt: number | null;
  readonly status: LicenceStatus;
  /** The accepted documents, exact; never shown by the API, given to modules as evidence. */
  readonly documents: {
    readonly token: string;
    readonly revocation: string | null;
    readonly kind: VerifiedLicenceToken['kind'];
  };
}

export interface LicenceOverview {
  /** Exact root-signed list after verification, including global certificate revocations. */
  readonly revocationList: string | null;
  /** The installation id the writer recorded; null before it did. */
  readonly installation: string | null;
  readonly effectiveTime: number;
  readonly clockRollback: boolean;
  readonly pendingRequests: number;
  readonly licences: readonly LicenceSummary[];
}

export interface LicenceReader {
  readonly store: LicenceStore;
  readonly verifier: LicenceVerifier;
}

function tokenOf(reader: LicenceReader, row: StoredActivation) {
  const kind: VerifiedLicenceToken['kind'] =
    row.activation === 'offline' ? 'offline-activation' : 'activation';
  try {
    return { token: reader.verifier.token(row.token, kind), kind, invalid: null };
  } catch (error) {
    if (!(error instanceof LicenceDocumentRefused)) throw error;
    return { token: null, kind, invalid: `document_${error.failure}` };
  }
}

function revocationOf(reader: LicenceReader, row: StoredActivation): string | null {
  if (row.revocation === null) return null;
  try {
    const statement = reader.verifier.revocation(row.revocation);
    return statement.activationId === row.activationId ? statement.reason : null;
  } catch (error) {
    // A statement that no longer verifies revokes nothing; it stays as kept.
    if (error instanceof LicenceDocumentRefused) return null;
    throw error;
  }
}

function listOf(reader: LicenceReader, text: string | undefined): VerifiedRevocationList | null {
  if (text === undefined) return null;
  try {
    return reader.verifier.revocationList(text);
  } catch (error) {
    if (error instanceof LicenceDocumentRefused) return null;
    throw error;
  }
}

function listed(list: VerifiedRevocationList | null, token: VerifiedLicenceToken | null) {
  if (list === null || token === null) return null;
  if (list.certificates.has(token.signer)) return 'certificate_revoked';
  return list.licences.has(token.licenceId) ? 'licence_revoked' : null;
}

function summary(
  reader: LicenceReader,
  row: StoredActivation,
  context: {
    readonly list: VerifiedRevocationList | null;
    readonly installation: string | null;
    readonly now: number;
  },
): LicenceSummary {
  const { token, kind, invalid } = tokenOf(reader, row);
  const status = licenceStatus(
    {
      token:
        token === null
          ? null
          : { ...token, activation: kind === 'offline-activation' ? 'offline' : 'online' },
      invalid,
      revoked: revocationOf(reader, row) ?? listed(context.list, token),
      failure: row.failure,
      lastRefreshAt: row.lastRefreshAt,
      mismatchSince: row.mismatchSince,
    },
    context.installation,
    context.now,
  );
  return {
    activationId: row.activationId,
    licenceId: row.licenceId,
    licensee: token?.licensee ?? null,
    licenseType: token?.type ?? null,
    activation: row.activation,
    features: token?.features ?? [],
    limits: token?.limits ?? {},
    issuedAt: token?.issuedAt ?? null,
    updatesUntil: token?.updatesUntil ?? null,
    lastRefreshAt: row.lastRefreshAt,
    nextAttemptAt: row.nextAttemptAt,
    status,
    documents: { token: row.token, revocation: row.revocation, kind },
  };
}

export async function licenceOverview(reader: LicenceReader): Promise<LicenceOverview> {
  const [rows, clock, now, databaseNow, list, pendingRequests] = await Promise.all([
    reader.store.activations(),
    reader.store.clock(),
    effectiveNow(reader.store),
    reader.store.databaseNow(),
    reader.store.revocationList(),
    reader.store.pendingRequests(),
  ]);
  const verifiedList = listOf(reader, list?.text);
  const context = { list: verifiedList, installation: clock.installation, now };
  return {
    revocationList: verifiedList === null ? null : (list?.text ?? null),
    installation: clock.installation,
    effectiveTime: now,
    clockRollback: licenceClockRolledBack(databaseNow, clock.maxSeen),
    pendingRequests,
    licences: rows.map((row) => summary(reader, row, context)),
  };
}

/** The state of an installation without a licence: an offline request may be waiting. */
export function emptyLicenceState(overview: LicenceOverview): LicenceState {
  return overview.pendingRequests > 0 ? 'pending' : 'none';
}
