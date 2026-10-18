import type { LicenseEvidence, LicenseService, LicenseView } from '@proanima/arkvory-extension-api';
import { emptyLicenceState, licenceIso, licenceOverview } from '@proanima/arkvory-application';
import type { LicenceOverview, LicenceReader, LicenceSummary } from '@proanima/arkvory-application';
import { bestLicence } from '@proanima/arkvory-domain';

const isoOrNull = (value: number | null) => (value === null ? null : licenceIso(value));

/** One licence as `LicenseView`: no key, secret, hub address or signature bytes. */
export function licenseViewOf(overview: LicenceOverview, licence: LicenceSummary): LicenseView {
  const { status } = licence;
  return {
    state: status.state,
    reason: status.reason,
    licenseId: licence.licenceId,
    licenseType: licence.licenseType,
    activation: licence.activation,
    features: licence.features,
    limits: licence.limits,
    notAfter: isoOrNull(status.notAfter),
    graceUntil: isoOrNull(status.graceUntil),
    offlineGraceUntil: isoOrNull(status.offlineGraceUntil),
    lastRefreshAt: isoOrNull(licence.lastRefreshAt),
    refreshFailing: status.refreshFailing,
    effectiveTime: licenceIso(overview.effectiveTime),
  };
}

/** The licence that carries `feature`, or the best one; `none`/`pending` without a licence. */
export function licenseView(overview: LicenceOverview, feature?: string): LicenseView {
  const index = bestLicence(overview.licences, feature);
  const licence = overview.licences[index];
  if (licence !== undefined && (feature === undefined || licence.features.includes(feature)))
    return licenseViewOf(overview, licence);
  return {
    state: overview.licences.length > 0 ? 'none' : emptyLicenceState(overview),
    reason: null,
    licenseId: null,
    licenseType: null,
    activation: null,
    features: [],
    limits: {},
    notAfter: null,
    graceUntil: null,
    offlineGraceUntil: null,
    lastRefreshAt: null,
    refreshFailing: false,
    effectiveTime: licenceIso(overview.effectiveTime),
  };
}

/**
 * The `license` service of modules (ADR 0078, R2; ADR 0083, 2.4) in a process of the core. It
 * reads what the writer keeps in the database and never waits for the hub. One overview serves
 * every call for `ttlMs`, so a module may ask on each write without a query each time.
 */
export function createLicenseService(
  reader: LicenceReader,
  options: { readonly ttlMs?: number; readonly now?: () => number } = {},
): LicenseService {
  const ttlMs = options.ttlMs ?? 10_000;
  const now = options.now ?? (() => performance.now());
  let cached: { readonly at: number; readonly overview: Promise<LicenceOverview> } | null = null;
  const overview = () => {
    if (cached === null || now() - cached.at >= ttlMs) {
      const loading = licenceOverview(reader);
      cached = { at: now(), overview: loading };
      // A failed read is not kept: the next call asks the database again.
      loading.catch(() => {
        if (cached?.overview === loading) cached = null;
      });
    }
    return cached.overview;
  };
  return {
    async view(feature) {
      return licenseView(await overview(), feature);
    },
    async evidence(): Promise<readonly LicenseEvidence[]> {
      const encoder = new TextEncoder();
      return (await overview()).licences.flatMap((licence) => {
        const documents: LicenseEvidence[] = [
          {
            licenseId: licence.licenceId,
            kind: licence.documents.kind,
            document: encoder.encode(licence.documents.token),
          },
        ];
        if (licence.documents.revocation !== null)
          documents.push({
            licenseId: licence.licenceId,
            kind: 'revocation',
            document: encoder.encode(licence.documents.revocation),
          });
        return documents;
      });
    },
  };
}
