/**
 * Per-account login backoff as a leaky bucket. Each verified wrong password adds one unit and
 * debt drains continuously. Backoff starts only above the threshold, so one client confined by
 * the per-address throttle (slower than the drain rate) cannot keep an account blocked; a
 * distributed attack causes delays that double per failure and stop at the cap.
 */
export interface LoginBackoffPolicy {
  readonly threshold: number;
  readonly drainMs: number;
  readonly maxDelayMs: number;
}
export const ACCOUNT_LOGIN_BACKOFF: LoginBackoffPolicy = {
  threshold: 20,
  drainMs: 6000,
  maxDelayMs: 120000,
};

export function drainedLoginDebt(
  debt: number,
  elapsedMs: number,
  policy: LoginBackoffPolicy = ACCOUNT_LOGIN_BACKOFF,
): number {
  if (!Number.isFinite(debt) || debt <= 0) return 0;
  return Math.max(0, debt - Math.max(0, elapsedMs) / policy.drainMs);
}

/** Delay imposed after a failure that left `debt` units; zero at or below the threshold. */
export function loginBackoffMs(
  debt: number,
  policy: LoginBackoffPolicy = ACCOUNT_LOGIN_BACKOFF,
): number {
  const excess = Math.floor(debt - policy.threshold);
  if (!Number.isFinite(excess) || excess < 1) return 0;
  return Math.min(policy.maxDelayMs, 1000 * 2 ** Math.min(excess - 1, 30));
}
