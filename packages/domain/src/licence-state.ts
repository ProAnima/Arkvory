/**
 * The state of a licence activation (ADR 0078, R2–R3), from facts the core verified and times in
 * milliseconds. Pure: the caller passes effective time, never the bare local clock. No state
 * here turns off a function of the core or makes data unreadable (I1): the state only tells a
 * paid module what its licence allows.
 */
export const LICENCE_STATES = [
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
export type LicenceState = (typeof LICENCE_STATES)[number];

const HOUR = 60 * 60 * 1000;
export const LICENCE_DAY = 24 * HOUR;

/** The verified token of an activation. */
export interface LicenceTokenFacts {
  readonly licenceId: string;
  readonly type: string;
  readonly installation: string;
  readonly features: readonly string[];
  readonly issuedAt: number;
  readonly refreshAfter: number;
  readonly notAfter: number;
  readonly licenceNotAfter: number | null;
  readonly graceDays: number;
  readonly activation: 'online' | 'offline';
}

/** What the core keeps about one activation. */
export interface LicenceFacts {
  /** Null when the stored token no longer verifies. */
  readonly token: LicenceTokenFacts | null;
  /** Code of the verification failure of a stored document. */
  readonly invalid: string | null;
  /** Reason of a kept revocation statement, or of the revocation list naming the licence. */
  readonly revoked: string | null;
  /** The last refusal of the hub or failure to reach it; null after a successful refresh. */
  readonly failure: string | null;
  readonly lastRefreshAt: number | null;
  /** When the writer first saw another installation id than the token's. */
  readonly mismatchSince: number | null;
}

export interface LicenceStatus {
  readonly state: LicenceState;
  readonly reason: string | null;
  readonly notAfter: number | null;
  readonly graceUntil: number | null;
  readonly offlineGraceUntil: number | null;
  readonly refreshFailing: boolean;
}

const status = (
  state: LicenceState,
  reason: string | null,
  rest: Partial<Omit<LicenceStatus, 'state' | 'reason'>> = {},
): LicenceStatus => ({
  state,
  reason,
  notAfter: rest.notAfter ?? null,
  graceUntil: rest.graceUntil ?? null,
  offlineGraceUntil: rest.offlineGraceUntil ?? null,
  refreshFailing: rest.refreshFailing ?? false,
});

/**
 * The state at effective time `now` for the writer's installation id (null: not recorded yet,
 * so no mismatch is claimed). Order: an invalid document, a revocation, another installation,
 * the token's end, the licence's end, then the refresh schedule of an online activation.
 */
export function licenceStatus(
  facts: LicenceFacts,
  installation: string | null,
  now: number,
): LicenceStatus {
  const token = facts.token;
  if (token === null) return status('invalid', facts.invalid ?? 'document_invalid');
  const times = {
    notAfter: token.licenceNotAfter,
    offlineGraceUntil: token.notAfter,
  };
  if (facts.revoked !== null) return status('revoked', facts.revoked, times);
  if (installation !== null && installation !== token.installation) {
    const since = facts.mismatchSince ?? now;
    const graceUntil = since + token.graceDays * LICENCE_DAY;
    return status('mismatch', 'installation_mismatch', { ...times, graceUntil });
  }
  const licenceEnd =
    token.licenceNotAfter === null ? null : token.licenceNotAfter + token.graceDays * LICENCE_DAY;
  if (now >= token.notAfter) {
    const ended = licenceEnd !== null && now >= licenceEnd;
    const reason = !ended
      ? 'activation_stale'
      : token.type === 'trial'
        ? 'trial_expired'
        : 'licence_expired';
    return status('expired', reason, times);
  }
  if (token.licenceNotAfter !== null && now >= token.licenceNotAfter)
    return status('grace', 'licence_expired', { ...times, graceUntil: licenceEnd });
  const failing = token.activation === 'online' && facts.failure !== null;
  if (token.activation === 'online' && now >= token.refreshAfter + LICENCE_DAY)
    return status('offline-grace', facts.failure ?? 'refresh_overdue', {
      ...times,
      refreshFailing: true,
    });
  const refreshFailing = failing && now >= token.refreshAfter;
  return status('valid', failing ? facts.failure : null, { ...times, refreshFailing });
}

/** Preference among licences: the one that allows the most comes first. */
const RANK: Readonly<Record<LicenceState, number>> = {
  valid: 0,
  'offline-grace': 1,
  grace: 2,
  mismatch: 3,
  pending: 4,
  expired: 5,
  revoked: 6,
  invalid: 7,
  none: 8,
};

/** The index of the best licence, preferring those that carry `feature`; -1 when none. */
export function bestLicence(
  licences: readonly { readonly status: LicenceStatus; readonly features: readonly string[] }[],
  feature?: string,
): number {
  let best = -1;
  const score = (index: number) => {
    const licence = licences[index];
    if (licence === undefined) return Number.POSITIVE_INFINITY;
    const carries = feature === undefined || licence.features.includes(feature);
    return RANK[licence.status.state] + (carries ? 0 : 100);
  };
  licences.forEach((_, index) => {
    if (best < 0 || score(index) < score(best)) best = index;
  });
  return best;
}

/**
 * Effective time (ADR 0078, 6.4 and R2): the latest of the database's clock, the highest time
 * the writer recorded and the latest `issuedAt` of an accepted document. Setting a clock back
 * never extends a token; a clock ahead is corrected by a new document, not by this value.
 */
export function effectiveLicenceTime(
  databaseNow: number,
  maxSeen: number | null,
  maxIssued: number | null,
): number {
  return Math.max(databaseNow, maxSeen ?? databaseNow, maxIssued ?? databaseNow);
}

/** A clock more than a day behind what was already seen: `clock_rollback_detected`. */
export function licenceClockRolledBack(databaseNow: number, maxSeen: number | null): boolean {
  return maxSeen !== null && maxSeen - databaseNow > LICENCE_DAY;
}

/** Refusals that the hub will repeat until an administrator acts: no automatic retry. */
export function licenceRetryable(failure: string): boolean {
  return [
    'unreachable',
    'timeout',
    'tls_failed',
    'hub_error',
    'rate_limited',
    'answer_invalid',
  ].includes(failure);
}

/**
 * The pause before the next refresh after `failures` failed attempts in a row (1 for the first):
 * 15 minutes doubling up to 6 hours, spread by ±20% with `random` in [0, 1). A `Retry-After` of
 * the hub is honoured when it is longer.
 */
export function licenceRetryDelay(failures: number, random: number, retryAfterMs = 0): number {
  const base = Math.min(15 * 60 * 1000 * 2 ** Math.max(0, Math.min(failures, 16) - 1), 6 * HOUR);
  const spread = base * (0.8 + 0.4 * Math.min(Math.max(random, 0), 1));
  return Math.max(Math.round(spread), retryAfterMs);
}

/**
 * When an online token is next refreshed: after `refreshAfter` plus the installation's own spread
 * of up to an hour (`random` in [0, 1)), so installations do not all ask the hub at one second.
 */
export function licenceRefreshAt(refreshAfter: number, random: number): number {
  return refreshAfter + Math.floor(Math.min(Math.max(random, 0), 1) * HOUR);
}
