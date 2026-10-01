import { ArkvoryError } from '@proanima/arkvory-domain';
import type { CredentialKind, Principal } from '@proanima/arkvory-domain';

export type SecurityAction =
  | 'auth.login'
  | 'auth.register'
  | 'auth.password.change'
  | 'user.create'
  | 'user.enable'
  | 'user.disable'
  | 'user.password.reset'
  | 'group.create'
  | 'group.member.add'
  | 'group.member.remove'
  | 'group.grant.set'
  | 'group.grant.remove'
  | 'token.create'
  | 'token.list'
  | 'token.revoke';
export type SecurityOutcome = 'success' | 'failure' | 'denied';
export type SecurityDetails = Readonly<Record<string, string | number | boolean | null>>;

/** Who acted. Anonymous password requests have no actor, only a client address. */
export interface SecurityActor {
  readonly id: string | null;
  readonly credential: CredentialKind | null;
  readonly clientIp: string | null;
}
export interface SecurityEvent {
  readonly action: SecurityAction;
  readonly target: string | null;
  readonly outcome: SecurityOutcome;
  /** Machine code for failures and denials; never a free-form exception message. */
  readonly code?: string;
  /** Small non-secret facts only: no passwords, token values or hashes. */
  readonly details?: SecurityDetails;
}
export interface SecurityAuditEntry {
  readonly id: string;
  readonly occurredAt: string;
  readonly actor: string | null;
  readonly credential: CredentialKind | null;
  readonly clientIp: string | null;
  readonly action: string;
  readonly target: string | null;
  readonly outcome: SecurityOutcome;
  readonly code: string | null;
  readonly details: SecurityDetails;
}
export interface SecurityAuditPage {
  readonly items: readonly SecurityAuditEntry[];
  readonly next: string | null;
}
/** Append port for events without a surrounding identity transaction (denials). */
export interface SecurityAuditLog {
  append(actor: SecurityActor, event: SecurityEvent): Promise<void>;
}
export interface SecurityAuditReader {
  list(after: string | undefined, limit: number): Promise<SecurityAuditPage>;
}

export function securityActor(principal: Principal, clientIp: string | null): SecurityActor {
  return { id: principal.id, credential: principal.credential, clientIp };
}
export function anonymousActor(clientIp: string | null): SecurityActor {
  return { id: null, credential: null, clientIp };
}

/** Newest-first keyset page; the cursor is the decimal id of the last returned entry. */
export function auditPageRequest(after: unknown, limit: unknown) {
  if (after !== undefined && (typeof after !== 'string' || !/^[1-9][0-9]{0,17}$/.test(after)))
    throw new ArkvoryError('invalid_input', 'Invalid audit cursor');
  const size =
    limit === undefined
      ? 50
      : typeof limit === 'string' && /^[0-9]{1,3}$/.test(limit)
        ? Number(limit)
        : 0;
  if (size < 1 || size > 100)
    throw new ArkvoryError('invalid_input', 'Audit page size must be 1 to 100');
  return { after, limit: size };
}
