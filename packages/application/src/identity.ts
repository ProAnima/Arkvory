import {
  ArkvoryError,
  requireAccountName,
  requireGroupName,
  requirePassword,
  requireGrant,
  requireTokenName,
  requireTokenScope,
  tokenExpiry,
} from '@proanima/arkvory-domain';
import type { Principal, TokenScope } from '@proanima/arkvory-domain';
import { anonymousActor, auditPageRequest, securityActor } from './security-audit.js';
import type {
  SecurityAction,
  SecurityActor,
  SecurityAuditLog,
  SecurityAuditReader,
} from './security-audit.js';

export interface Account {
  id: string;
  name: string;
  administrator: boolean;
  enabled: boolean;
}
export interface AccessGroup {
  id: string;
  name: string;
  members: readonly string[];
  grants: readonly { repository: string; access: 'read' | 'write' }[];
}
export interface LoginResult {
  token: string;
  expiresAt: string;
  account: Account;
}
export interface UserToken {
  id: string;
  userId: string;
  name: string;
  prefix: string;
  scope: TokenScope;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revoked: boolean;
}
export interface CreatedUserToken extends UserToken {
  token: string;
}
/** Self-registration may not consume the account capacity reserved for administrators. */
export type AccountOrigin = 'administrator' | 'self-registration';
export interface TokenRequest {
  readonly name: unknown;
  readonly expiresAt: unknown;
  readonly scope: unknown;
}
/**
 * Every mutation records its success audit row in the same transaction as the change, so the
 * journal never claims an uncommitted change and a committed change is never unaudited.
 */
export interface IdentityStore {
  createUser(
    name: string,
    password: string,
    administrator: boolean,
    origin: AccountOrigin,
    actor: SecurityActor,
  ): Promise<Account>;
  updateUser(
    id: string,
    enabled: boolean | undefined,
    password: string | undefined,
    actor: SecurityActor,
  ): Promise<Account>;
  users(): Promise<readonly Account[]>;
  createGroup(name: string, actor: SecurityActor): Promise<AccessGroup>;
  groups(): Promise<readonly AccessGroup[]>;
  membership(
    groupId: string,
    userId: string,
    present: boolean,
    actor: SecurityActor,
  ): Promise<void>;
  grant(
    groupId: string,
    repository: string,
    access: 'read' | 'write' | null,
    actor: SecurityActor,
  ): Promise<void>;
  /** Throws ThrottledError during account backoff without verifying the password. */
  login(name: string, password: string, actor: SecurityActor): Promise<LoginResult>;
  resolve(token: string): Promise<Principal | null>;
  logout(token: string): Promise<void>;
  /** Also revokes every session and personal token of the account. */
  changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    actor: SecurityActor,
  ): Promise<void>;
  createToken(
    userId: string,
    name: string,
    request: { expiresAt: Date; scope: TokenScope },
    actor: SecurityActor,
  ): Promise<CreatedUserToken>;
  tokens(userId: string): Promise<readonly UserToken[]>;
  revokeToken(userId: string, tokenId: string, actor: SecurityActor): Promise<void>;
}
export interface IdentityOptions {
  readonly allowRegistration: boolean;
  readonly now: () => Date;
  readonly audit: SecurityAuditLog & SecurityAuditReader;
}

export class IdentityService {
  readonly allowRegistration: boolean;
  constructor(
    private readonly store: IdentityStore,
    private readonly options: IdentityOptions,
  ) {
    this.allowRegistration = options.allowRegistration;
  }
  /** Account administration never runs through a personal token or a managed service key. */
  private admin(principal: Principal): void {
    if (!principal.administrator || principal.managed || principal.credential === 'personal-token')
      throw new ArkvoryError('forbidden', 'Administrator access required');
  }
  /** Credentials are managed from an interactive session only; tokens cannot mint tokens. */
  private async session(principal: Principal, clientIp: string | null, action: SecurityAction) {
    if (principal.credential === 'session' && principal.id.startsWith('user:'))
      return principal.id.slice(5);
    await this.options.audit.append(securityActor(principal, clientIp), {
      action,
      target: principal.id,
      outcome: 'denied',
      code: 'session_required',
    });
    throw new ArkvoryError('forbidden', 'Account session required');
  }
  async createUser(
    principal: Principal,
    name: unknown,
    password: unknown,
    administrator: unknown,
    clientIp: string | null,
  ) {
    this.admin(principal);
    if (typeof administrator !== 'boolean')
      throw new ArkvoryError('invalid_input', 'Administrator flag is required');
    return this.store.createUser(
      requireAccountName(name),
      requirePassword(password),
      administrator,
      'administrator',
      securityActor(principal, clientIp),
    );
  }
  async updateUser(principal: Principal, id: string, value: unknown, clientIp: string | null) {
    this.admin(principal);
    if (typeof value !== 'object' || value === null || Array.isArray(value))
      throw new ArkvoryError('invalid_input', 'Invalid account update');
    const body: Record<string, unknown> = Object.fromEntries(Object.entries(value));
    if (
      Object.keys(body).length === 0 ||
      Object.keys(body).some((key) => !['enabled', 'password'].includes(key)) ||
      (body['enabled'] !== undefined && typeof body['enabled'] !== 'boolean')
    )
      throw new ArkvoryError('invalid_input', 'Invalid account update');
    return this.store.updateUser(
      id,
      body['enabled'] === undefined ? undefined : body['enabled'],
      body['password'] === undefined ? undefined : requirePassword(body['password']),
      securityActor(principal, clientIp),
    );
  }
  async users(principal: Principal) {
    this.admin(principal);
    return this.store.users();
  }
  async createGroup(principal: Principal, name: unknown, clientIp: string | null) {
    this.admin(principal);
    return this.store.createGroup(requireGroupName(name), securityActor(principal, clientIp));
  }
  async groups(principal: Principal) {
    this.admin(principal);
    return this.store.groups();
  }
  async membership(
    principal: Principal,
    groupId: string,
    userId: string,
    present: boolean,
    clientIp: string | null,
  ) {
    this.admin(principal);
    return this.store.membership(groupId, userId, present, securityActor(principal, clientIp));
  }
  async grant(
    principal: Principal,
    groupId: string,
    repository: unknown,
    access: unknown,
    clientIp: string | null,
  ) {
    this.admin(principal);
    const actor = securityActor(principal, clientIp);
    if (access === null) {
      if (typeof repository !== 'string')
        throw new ArkvoryError('invalid_input', 'Invalid repository');
      return this.store.grant(groupId, requireGrant(repository, 'read').repository, null, actor);
    }
    const value = requireGrant(repository, access);
    return this.store.grant(groupId, value.repository, value.access, actor);
  }
  /** requestId correlates the anonymous attempt with the access log; it is not an identity. */
  async login(name: unknown, password: unknown, clientIp: string | null, requestId?: string) {
    return this.store.login(
      requireAccountName(name),
      requirePassword(password),
      anonymousActor(clientIp, requestId),
    );
  }
  resolve(token: string) {
    return this.store.resolve(token);
  }
  logout(token: string) {
    return this.store.logout(token);
  }
  async changePassword(
    principal: Principal,
    currentPassword: unknown,
    newPassword: unknown,
    clientIp: string | null,
  ) {
    const userId = await this.session(principal, clientIp, 'auth.password.change');
    return this.store.changePassword(
      userId,
      requirePassword(currentPassword),
      requirePassword(newPassword),
      securityActor(principal, clientIp),
    );
  }
  async register(name: unknown, password: unknown, clientIp: string | null, requestId?: string) {
    if (!this.allowRegistration)
      throw new ArkvoryError('forbidden', 'Account registration is disabled');
    const validName = requireAccountName(name);
    const validPassword = requirePassword(password);
    const actor = anonymousActor(clientIp, requestId);
    await this.store.createUser(validName, validPassword, false, 'self-registration', actor);
    return this.store.login(validName, validPassword, actor);
  }
  async createToken(principal: Principal, request: TokenRequest, clientIp: string | null) {
    const userId = await this.session(principal, clientIp, 'token.create');
    const name = requireTokenName(request.name);
    const scope = requireTokenScope(request.scope);
    const expiresAt = tokenExpiry(request.expiresAt, this.options.now().getTime());
    return this.store.createToken(
      userId,
      name,
      { expiresAt, scope },
      securityActor(principal, clientIp),
    );
  }
  async tokens(principal: Principal, clientIp: string | null) {
    return this.store.tokens(await this.session(principal, clientIp, 'token.list'));
  }
  async revokeToken(principal: Principal, tokenId: string, clientIp: string | null) {
    const userId = await this.session(principal, clientIp, 'token.revoke');
    return this.store.revokeToken(userId, tokenId, securityActor(principal, clientIp));
  }
  async accountTokens(principal: Principal, userId: string) {
    this.admin(principal);
    return this.store.tokens(userId);
  }
  async revokeAccountToken(
    principal: Principal,
    userId: string,
    tokenId: string,
    clientIp: string | null,
  ) {
    this.admin(principal);
    return this.store.revokeToken(userId, tokenId, securityActor(principal, clientIp));
  }
  async securityAudit(principal: Principal, after: unknown, limit: unknown) {
    this.admin(principal);
    const page = auditPageRequest(after, limit);
    return this.options.audit.list(page.after, page.limit);
  }
}
