import {
  ArkvoryError,
  requireAccountName,
  requireGroupName,
  requirePassword,
  requireGrant,
  requireTokenName,
} from '@proanima/arkvory-domain';
import type { Principal } from '@proanima/arkvory-domain';

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
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revoked: boolean;
}
export interface CreatedUserToken extends UserToken {
  token: string;
}
export interface IdentityStore {
  createUser(name: string, password: string, administrator: boolean): Promise<Account>;
  updateUser(
    id: string,
    enabled: boolean | undefined,
    password: string | undefined,
  ): Promise<Account>;
  users(): Promise<readonly Account[]>;
  createGroup(name: string): Promise<AccessGroup>;
  groups(): Promise<readonly AccessGroup[]>;
  membership(groupId: string, userId: string, present: boolean): Promise<void>;
  grant(groupId: string, repository: string, access: 'read' | 'write' | null): Promise<void>;
  login(name: string, password: string): Promise<LoginResult>;
  resolve(token: string): Promise<Principal | null>;
  logout(token: string): Promise<void>;
  changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void>;
  createToken(userId: string, name: string, expiresAt?: string): Promise<CreatedUserToken>;
  tokens(userId: string): Promise<readonly UserToken[]>;
  revokeToken(userId: string, tokenId: string): Promise<void>;
}

export class IdentityService {
  constructor(
    private readonly store: IdentityStore,
    readonly allowRegistration = false,
  ) {}
  private admin(principal: Principal): void {
    if (!principal.administrator)
      throw new ArkvoryError('forbidden', 'Administrator access required');
  }
  createUser(principal: Principal, name: unknown, password: unknown, administrator: unknown) {
    this.admin(principal);
    if (typeof administrator !== 'boolean')
      throw new ArkvoryError('invalid_input', 'Administrator flag is required');
    return this.store.createUser(
      requireAccountName(name),
      requirePassword(password),
      administrator,
    );
  }
  updateUser(principal: Principal, id: string, value: unknown) {
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
    );
  }
  users(principal: Principal) {
    this.admin(principal);
    return this.store.users();
  }
  createGroup(principal: Principal, name: unknown) {
    this.admin(principal);
    return this.store.createGroup(requireGroupName(name));
  }
  groups(principal: Principal) {
    this.admin(principal);
    return this.store.groups();
  }
  membership(principal: Principal, groupId: string, userId: string, present: boolean) {
    this.admin(principal);
    return this.store.membership(groupId, userId, present);
  }
  grant(principal: Principal, groupId: string, repository: unknown, access: unknown) {
    this.admin(principal);
    if (access === null) {
      if (typeof repository !== 'string')
        throw new ArkvoryError('invalid_input', 'Invalid repository');
      return this.store.grant(groupId, requireGrant(repository, 'read').repository, null);
    }
    const value = requireGrant(repository, access);
    return this.store.grant(groupId, value.repository, value.access);
  }
  login(name: unknown, password: unknown) {
    return this.store.login(requireAccountName(name), requirePassword(password));
  }
  resolve(token: string) {
    return this.store.resolve(token);
  }
  logout(token: string) {
    return this.store.logout(token);
  }
  changePassword(principal: Principal, currentPassword: unknown, newPassword: unknown) {
    if (!principal.id.startsWith('user:'))
      throw new ArkvoryError('forbidden', 'Account session required');
    return this.store.changePassword(
      principal.id.slice(5),
      requirePassword(currentPassword),
      requirePassword(newPassword),
    );
  }
  async register(name: unknown, password: unknown) {
    if (!this.allowRegistration)
      throw new ArkvoryError('forbidden', 'Account registration is disabled');
    const validName = requireAccountName(name);
    const validPassword = requirePassword(password);
    await this.store.createUser(validName, validPassword, false);
    return this.store.login(validName, validPassword);
  }
  createToken(principal: Principal, name: unknown, expiresAt?: unknown) {
    if (!principal.id.startsWith('user:'))
      throw new ArkvoryError('forbidden', 'Account session required');
    if (expiresAt !== undefined && typeof expiresAt !== 'string')
      throw new ArkvoryError('invalid_input', 'Invalid expiresAt timestamp');
    return this.store.createToken(principal.id.slice(5), requireTokenName(name), expiresAt);
  }
  tokens(principal: Principal) {
    if (!principal.id.startsWith('user:'))
      throw new ArkvoryError('forbidden', 'Account session required');
    return this.store.tokens(principal.id.slice(5));
  }
  revokeToken(principal: Principal, tokenId: string) {
    if (!principal.id.startsWith('user:'))
      throw new ArkvoryError('forbidden', 'Account session required');
    return this.store.revokeToken(principal.id.slice(5), tokenId);
  }
}
