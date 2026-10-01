import { ArkvoryError, requireRepository } from './artifact.js';
import type { TokenScope } from './credentials.js';
import type { ErrorReasonOf } from './errors.js';

export function requireAccountName(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_.-]{3,64}$/.test(value))
    throw new ArkvoryError('invalid_input', 'Invalid account name');
  return value;
}

export function requireGroupName(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_.-]{2,64}$/.test(value))
    throw new ArkvoryError('invalid_input', 'Invalid group name');
  return value;
}

export function requirePassword(value: unknown): string {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128)
    throw new ArkvoryError('invalid_input', 'Password must contain 12 to 128 characters');
  return value;
}

export function requireTokenName(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > 64)
    throw new ArkvoryError('invalid_input', 'Token name must contain 1 to 64 characters');
  return value.trim();
}

export function requireGrant(repository: unknown, access: unknown) {
  if (typeof repository !== 'string') throw new ArkvoryError('invalid_input', 'Invalid repository');
  requireRepository(repository);
  if (access !== 'read' && access !== 'write')
    throw new ArkvoryError('invalid_input', 'Invalid repository access');
  return { repository, access } as const;
}

export function requireTokenScope(value: unknown): TokenScope {
  // Omitted scope keeps the original wire behaviour of a full account token.
  if (value === undefined) return 'read-write';
  if (value !== 'read' && value !== 'read-write')
    throw new ArkvoryError('invalid_input', 'Token scope must be read or read-write');
  return value;
}

const day = 24 * 60 * 60 * 1000;
export const TOKEN_DEFAULT_LIFETIME_MS = 90 * day;
export const TOKEN_MAX_LIFETIME_MS = 365 * day;
// Clients compute "now + 365 days" on their own clock; a small skew is clamped, not rejected.
const tokenClockSkewMs = 60 * 60 * 1000;
const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** Mandatory personal token expiry: default 90 days, at most 365 days, never in the past. */
export function tokenExpiry(value: unknown, nowMs: number): Date {
  if (value === undefined) return new Date(nowMs + TOKEN_DEFAULT_LIFETIME_MS);
  if (typeof value !== 'string' || !timestamp.test(value))
    throw new ArkvoryError('invalid_input', 'expiresAt must be an RFC 3339 timestamp');
  const expires = Date.parse(value);
  if (!Number.isFinite(expires)) throw new ArkvoryError('invalid_input', 'Invalid expiresAt');
  if (expires <= nowMs) throw new ArkvoryError('invalid_input', 'expiresAt must be in the future');
  const maximum = nowMs + TOKEN_MAX_LIFETIME_MS;
  if (expires > maximum + tokenClockSkewMs)
    throw new ArkvoryError('invalid_input', 'Personal tokens expire within 365 days');
  return new Date(Math.min(expires, maximum));
}

/** Refusal before any password work; `retryAfterSeconds` is safe to disclose to the caller. */
export class ThrottledError extends ArkvoryError {
  constructor(
    retryAfterSeconds: number,
    reason: ErrorReasonOf<'rate_limited'> = 'login_attempts',
    message = 'Too many authentication attempts; retry later',
  ) {
    super('rate_limited', message, { reason, retryAfterSeconds });
    this.name = 'ThrottledError';
  }
}
