/**
 * The `license` service (ADR 0078, 6.5 and R2; ADR 0083, 2.4): what a ProAnimaStudio module with
 * a `licenseFeature` may read about the installation's licences. It only reads. The core decides
 * nothing about features: the module decides what it allows in each state and keeps I1 (data
 * stays readable and recoverable) in every one. Licence keys, activation secrets and the hub's
 * address never reach a module.
 *
 * States (ADR 0078, R3):
 * - `none` — no licence; `pending` — an offline request waits for its answer;
 * - `valid` — the licence holds (`refreshFailing` when the hub has not answered since
 *   `refreshAfter`, for less than a day);
 * - `offline-grace` — refreshing has failed for more than a day; the token holds until
 *   `offlineGraceUntil`;
 * - `grace` — the licence term ended; renewal grace runs until `graceUntil`;
 * - `expired` — with `reason` `trial_expired`, `licence_expired` or `activation_stale`;
 * - `revoked` — a signed revocation statement or list, `reason` names it;
 * - `mismatch` — the token belongs to another installation (a restore elsewhere): writes in the
 *   module's mode only until `graceUntil`;
 * - `invalid` — a stored document no longer verifies.
 */
export const LICENSE_STATES = [
  'none',
  'pending',
  'valid',
  'offline-grace',
  'grace',
  'expired',
  'revoked',
  'mismatch',
  'invalid',
] as const;
export type LicenseState = (typeof LICENSE_STATES)[number];

/** One licence of the installation as the core verified it; times are ISO 8601 UTC. */
export interface LicenseView {
  readonly state: LicenseState;
  /** Machine code of the state or of the last refusal of the hub; null when none. */
  readonly reason: string | null;
  readonly licenseId: string | null;
  /** `trial`, `standard`, `multi-site`, `enterprise`, or a newer type shown as it is. */
  readonly licenseType: string | null;
  readonly activation: 'online' | 'offline' | null;
  readonly features: readonly string[];
  /** Decimal strings of unsigned 64-bit values. */
  readonly limits: Readonly<Record<string, string>>;
  /** The end of the licence term; null for a perpetual licence or without a licence. */
  readonly notAfter: string | null;
  /** The end of renewal grace (`grace`) or of the grace after a restore elsewhere (`mismatch`). */
  readonly graceUntil: string | null;
  /** The end of the current token: writes in the module's mode stop there without a refresh. */
  readonly offlineGraceUntil: string | null;
  readonly lastRefreshAt: string | null;
  readonly refreshFailing: boolean;
  /**
   * The time the core judged by: the latest of the database's clock, the highest time it saw and
   * the latest `issuedAt` of an accepted document. Setting a clock back does not move it back.
   */
  readonly effectiveTime: string;
}

/** An accepted document, exactly as the hub signed it, for a module to verify on its own. */
export interface LicenseEvidence {
  readonly licenseId: string;
  readonly kind: 'activation' | 'offline-activation' | 'revocation';
  /** UTF-8 bytes of the envelope with its chain. */
  readonly document: Uint8Array;
}

export interface LicenseService {
  /**
   * The licence that carries `feature`, or the installation's best licence without one. It never
   * waits for the hub: it reads the state the core keeps.
   */
  view(feature?: string): Promise<LicenseView>;
  /** The accepted tokens and revocation statements of every licence. */
  evidence(): Promise<readonly LicenseEvidence[]>;
}
