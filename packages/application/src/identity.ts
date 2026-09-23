import {
  DepotError,
  requireAccountName,
  requireGroupName,
  requirePassword,
  requireGrant,
} from '@proanima/depot-domain';
import type { Principal } from '@proanima/depot-domain';

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
}

export class IdentityService {
  constructor(private readonly store: IdentityStore) {}
  private admin(principal: Principal): void {
    if (!principal.administrator)
      throw new DepotError('forbidden', 'Administrator access required');
  }
  createUser(principal: Principal, name: unknown, password: unknown, administrator: unknown) {
    this.admin(principal);
    if (typeof administrator !== 'boolean')
      throw new DepotError('invalid_input', 'Administrator flag is required');
    return this.store.createUser(
      requireAccountName(name),
      requirePassword(password),
      administrator,
    );
  }
  updateUser(principal: Principal, id: string, value: unknown) {
    this.admin(principal);
    if (typeof value !== 'object' || value === null || Array.isArray(value))
      throw new DepotError('invalid_input', 'Invalid account update');
    const body: Record<string, unknown> = Object.fromEntries(Object.entries(value));
    if (
      Object.keys(body).length === 0 ||
      Object.keys(body).some((key) => !['enabled', 'password'].includes(key)) ||
      (body['enabled'] !== undefined && typeof body['enabled'] !== 'boolean')
    )
      throw new DepotError('invalid_input', 'Invalid account update');
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
        throw new DepotError('invalid_input', 'Invalid repository');
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
      throw new DepotError('forbidden', 'Account session required');
    return this.store.changePassword(
      principal.id.slice(5),
      requirePassword(currentPassword),
      requirePassword(newPassword),
    );
  }
}
