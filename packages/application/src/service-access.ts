import {
  ArkvoryError,
  parseBindings,
  requireAccountName,
  requireId,
  parseAdministrationActions,
} from '@proanima/arkvory-domain';
import type {
  Principal,
  ServiceBinding,
  ServiceDelegation,
  AdministrationAction,
} from '@proanima/arkvory-domain';

export interface ServiceAccount {
  id: string;
  name: string;
  enabled: boolean;
  revision: number;
  bindings: readonly ServiceBinding[];
  createdAt: string;
}
export interface ApiKey {
  id: string;
  accountId: string;
  name: string;
  state: 'pending' | 'active' | 'revoked';
  bindings: readonly ServiceBinding[];
  createdAt: string;
  expiresAt: string;
  activationExpiresAt: string;
  rotatedFrom: string | null;
}
export interface KeyIssue {
  key: ApiKey;
  secret?: string;
}
export interface ServicePage<T> {
  items: readonly T[];
  next: string | null;
}
export interface ServiceAudit {
  sequence: string;
  actor: string;
  action: string;
  accountId: string;
  keyId: string | null;
  occurredAt: string;
}
export interface ServiceStore {
  accounts(actor: Principal, after?: string): Promise<ServicePage<ServiceAccount>>;
  account(
    actor: Principal,
    id: string,
    scope?: 'service-account.read' | 'policy.read',
  ): Promise<ServiceAccount>;
  create(
    actor: Principal,
    name: string,
    bindings: readonly ServiceBinding[],
  ): Promise<ServiceAccount>;
  update(actor: Principal, id: string, expected: number, enabled: boolean): Promise<ServiceAccount>;
  policy(
    actor: Principal,
    id: string,
    expected: number,
    bindings: readonly ServiceBinding[],
  ): Promise<ServiceAccount>;
  keys(actor: Principal, accountId: string, after?: string): Promise<ServicePage<ApiKey>>;
  key(actor: Principal, id: string): Promise<ApiKey>;
  issue(
    actor: Principal,
    accountId: string,
    idempotencyKey: string,
    name: string,
    bindings: readonly ServiceBinding[],
    expiresAt: string | undefined,
    rotate?: boolean,
  ): Promise<KeyIssue>;
  revoke(actor: Principal, id: string): Promise<void>;
  delegations(actor: Principal, keyId: string): Promise<readonly ServiceDelegation[]>;
  setDelegation(
    actor: Principal,
    keyId: string,
    target: string,
    expected: number,
    actions: readonly AdministrationAction[],
    ceiling: readonly ServiceBinding[],
  ): Promise<ServiceDelegation>;
  removeDelegation(
    actor: Principal,
    keyId: string,
    target: string,
    expected: number,
  ): Promise<ServiceDelegation>;
  activate(token: string): Promise<void>;
  resolve(token: string, pending?: boolean): Promise<Principal | null>;
  principalForKey(id: string): Promise<Principal | null>;
  audit(actor: Principal, accountId: string, after: string): Promise<readonly ServiceAudit[]>;
}
function fields(value: unknown, names: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new ArkvoryError('invalid_input', 'Object required');
  const row: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  if (Object.keys(row).some((key) => !names.includes(key)))
    throw new ArkvoryError('invalid_input', 'Unknown service field');
  return row;
}
function revision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value >= 2147483647)
    throw new ArkvoryError('invalid_input', 'Valid expectedRevision required');
  return value;
}
export class ServiceAccess {
  constructor(private readonly store: ServiceStore) {}
  private admin(p: Principal): void {
    if (!p.managed && p.serviceAdministrator !== true)
      throw new ArkvoryError('forbidden', 'Bootstrap or delegated managed credential required', {
        reason: 'permission_missing',
      });
  }
  private bootstrap(p: Principal): void {
    if (p.managed || p.serviceAdministrator !== true)
      throw new ArkvoryError('forbidden', 'Local service bootstrap authority required', {
        reason: 'permission_missing',
      });
  }
  delegations(p: Principal, keyId: string) {
    this.admin(p);
    if (p.managed && p.managed.keyId !== keyId)
      throw new ArkvoryError('forbidden', 'Only own delegations may be read', {
        reason: 'permission_missing',
      });
    return this.store.delegations(p, requireId(keyId));
  }
  setDelegation(p: Principal, keyId: string, target: string, value: unknown) {
    this.bootstrap(p);
    const body = fields(value, ['expectedRevision', 'actions', 'ceiling']);
    const expected = body['expectedRevision'] === 0 ? 0 : revision(body['expectedRevision']);
    const ceiling = parseBindings(body['ceiling']);
    if (ceiling.length > 16)
      throw new ArkvoryError('invalid_input', 'At most 16 delegation ceiling bindings');
    return this.store.setDelegation(
      p,
      requireId(keyId),
      requireId(target),
      expected,
      parseAdministrationActions(body['actions']),
      ceiling,
    );
  }
  removeDelegation(p: Principal, keyId: string, target: string, value: unknown) {
    this.bootstrap(p);
    const body = fields(value, ['expectedRevision']);
    return this.store.removeDelegation(
      p,
      requireId(keyId),
      requireId(target),
      revision(body['expectedRevision']),
    );
  }
  accounts(p: Principal, after?: string) {
    this.admin(p);
    return this.store.accounts(p, after === undefined ? undefined : requireId(after));
  }
  account(p: Principal, id: string, policy = false) {
    this.admin(p);
    return this.store.account(p, requireId(id), policy ? 'policy.read' : 'service-account.read');
  }
  create(p: Principal, value: unknown) {
    this.bootstrap(p);
    const body = fields(value, ['name', 'bindings']);
    return this.store.create(p, requireAccountName(body['name']), parseBindings(body['bindings']));
  }
  update(p: Principal, id: string, value: unknown) {
    this.admin(p);
    const body = fields(value, ['expectedRevision', 'enabled']);
    if (typeof body['enabled'] !== 'boolean')
      throw new ArkvoryError('invalid_input', 'Enabled is required');
    return this.store.update(p, requireId(id), revision(body['expectedRevision']), body['enabled']);
  }
  policy(p: Principal, id: string, value: unknown) {
    this.admin(p);
    const body = fields(value, ['expectedRevision', 'bindings']);
    return this.store.policy(
      p,
      requireId(id),
      revision(body['expectedRevision']),
      parseBindings(body['bindings']),
    );
  }
  keys(p: Principal, id: string, after?: string) {
    this.admin(p);
    return this.store.keys(p, requireId(id), after === undefined ? undefined : requireId(after));
  }
  key(p: Principal, id: string) {
    this.admin(p);
    return this.store.key(p, requireId(id));
  }
  issue(p: Principal, id: string, key: unknown, value: unknown, rotate = false) {
    this.admin(p);
    if (typeof key !== 'string' || !/^[a-zA-Z0-9_.:-]{1,128}$/.test(key))
      throw new ArkvoryError('invalid_input', 'Valid Idempotency-Key required');
    const body = fields(value, ['name', 'bindings', 'expiresAt']);
    const expires = body['expiresAt'];
    if (
      expires !== undefined &&
      (typeof expires !== 'string' ||
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(expires) ||
        !Number.isFinite(Date.parse(expires)))
    )
      throw new ArkvoryError('invalid_input', 'UTC expiresAt required');
    return this.store.issue(
      p,
      requireId(id),
      key,
      requireAccountName(body['name']),
      parseBindings(body['bindings']),
      expires,
      rotate,
    );
  }
  revoke(p: Principal, id: string) {
    this.admin(p);
    return this.store.revoke(p, requireId(id));
  }
  activate(token: string) {
    return this.store.activate(token);
  }
  audit(p: Principal, id: string, after = '0') {
    this.admin(p);
    if (!/^(0|[1-9][0-9]{0,17})$/.test(after))
      throw new ArkvoryError('invalid_input', 'Invalid audit cursor');
    return this.store.audit(p, requireId(id), after);
  }
}
