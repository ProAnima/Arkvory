import type { UserTokenResponse, UserTokenScope } from '@proanima/arkvory-contracts';

export const tokenLifetimes = [30, 90, 365] as const;
export type TokenLifetime = (typeof tokenLifetimes)[number];
const day = 24 * 60 * 60 * 1000;

/** Unknown form values fall back to the safe defaults: 90 days and read-only. */
export function tokenLifetime(value: string): TokenLifetime {
  return tokenLifetimes.find((days) => String(days) === value) ?? 90;
}
export function tokenScopeChoice(value: string): UserTokenScope {
  return value === 'read-write' ? 'read-write' : 'read';
}
/** 90 days uses the server default, so a skewed browser clock cannot affect the common case. */
export function tokenRequest(
  days: TokenLifetime,
  scope: UserTokenScope,
  nowMs: number,
): { expiresAt?: string; scope: UserTokenScope } {
  return days === 90 ? { scope } : { scope, expiresAt: new Date(nowMs + days * day).toISOString() };
}
export type TokenState = 'active' | 'revoked' | 'expired';
export function tokenState(token: UserTokenResponse, nowMs: number): TokenState {
  if (token.revoked) return 'revoked';
  if (token.expiresAt !== null && Date.parse(token.expiresAt) <= nowMs) return 'expired';
  return 'active';
}

export interface Toggle {
  hidden: boolean;
}
/** Sign-up stays hidden unless the server explicitly reports self-registration as enabled. */
export function applyRegistrationOption(
  enabled: boolean,
  controls: { toggle: Toggle; register: Toggle; login: Toggle },
): void {
  controls.toggle.hidden = !enabled;
  if (enabled) return;
  controls.register.hidden = true;
  controls.login.hidden = false;
}
export async function registrationEnabled(
  read: () => Promise<{ selfRegistration: boolean }>,
): Promise<boolean> {
  try {
    return (await read()).selfRegistration;
  } catch {
    // Older servers and network failures keep the control hidden.
    return false;
  }
}
