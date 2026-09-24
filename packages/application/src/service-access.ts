import { DepotError, parseBindings, requireAccountName, requireId } from '@proanima/depot-domain';
import type { Principal, ServiceBinding } from '@proanima/depot-domain';

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
  accounts(after?: string): Promise<ServicePage<ServiceAccount>>;
  account(id: string): Promise<ServiceAccount>;
  create(actor: string, name: string, bindings: readonly ServiceBinding[]): Promise<ServiceAccount>;
  update(actor: string, id: string, expected: number, enabled: boolean): Promise<ServiceAccount>;
  policy(
    actor: string,
    id: string,
    expected: number,
    bindings: readonly ServiceBinding[],
  ): Promise<ServiceAccount>;
  keys(accountId: string, after?: string): Promise<ServicePage<ApiKey>>;
  key(id: string): Promise<ApiKey>;
  issue(
    actor: string,
    accountId: string,
    idempotencyKey: string,
    name: string,
    bindings: readonly ServiceBinding[],
    expiresAt: string | undefined,
    rotatedFrom?: string,
  ): Promise<KeyIssue>;
  revoke(actor: string, id: string): Promise<void>;
  activate(token: string): Promise<void>;
  resolve(token: string, pending?: boolean): Promise<Principal | null>;
  principalForKey(id: string): Promise<Principal | null>;
  audit(accountId: string, after: string): Promise<readonly ServiceAudit[]>;
}
function fields(value: unknown, names: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new DepotError('invalid_input', 'Object required');
  const row: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  if (Object.keys(row).some((key) => !names.includes(key)))
    throw new DepotError('invalid_input', 'Unknown service field');
  return row;
}
function revision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value >= 2147483647)
    throw new DepotError('invalid_input', 'Valid expectedRevision required');
  return value;
}
export class ServiceAccess {
  constructor(private readonly store: ServiceStore) {}
  private admin(p: Principal): void {
    if (p.managed || p.serviceAdministrator !== true)
      throw new DepotError('forbidden', 'Local service bootstrap authority required');
  }
  accounts(p: Principal, after?: string) {
    this.admin(p);
    return this.store.accounts(after === undefined ? undefined : requireId(after));
  }
  account(p: Principal, id: string) {
    this.admin(p);
    return this.store.account(requireId(id));
  }
  create(p: Principal, value: unknown) {
    this.admin(p);
    const body = fields(value, ['name', 'bindings']);
    return this.store.create(
      p.id,
      requireAccountName(body['name']),
      parseBindings(body['bindings']),
    );
  }
  update(p: Principal, id: string, value: unknown) {
    this.admin(p);
    const body = fields(value, ['expectedRevision', 'enabled']);
    if (typeof body['enabled'] !== 'boolean')
      throw new DepotError('invalid_input', 'Enabled is required');
    return this.store.update(
      p.id,
      requireId(id),
      revision(body['expectedRevision']),
      body['enabled'],
    );
  }
  policy(p: Principal, id: string, value: unknown) {
    this.admin(p);
    const body = fields(value, ['expectedRevision', 'bindings']);
    return this.store.policy(
      p.id,
      requireId(id),
      revision(body['expectedRevision']),
      parseBindings(body['bindings']),
    );
  }
  keys(p: Principal, id: string, after?: string) {
    this.admin(p);
    return this.store.keys(requireId(id), after === undefined ? undefined : requireId(after));
  }
  key(p: Principal, id: string) {
    this.admin(p);
    return this.store.key(requireId(id));
  }
  async issue(p: Principal, id: string, key: unknown, value: unknown, rotate = false) {
    this.admin(p);
    if (typeof key !== 'string' || !/^[a-zA-Z0-9_.:-]{1,128}$/.test(key))
      throw new DepotError('invalid_input', 'Valid Idempotency-Key required');
    const body = fields(value, ['name', 'bindings', 'expiresAt']);
    const expires = body['expiresAt'];
    if (
      expires !== undefined &&
      (typeof expires !== 'string' ||
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(expires) ||
        !Number.isFinite(Date.parse(expires)))
    )
      throw new DepotError('invalid_input', 'UTC expiresAt required');
    const old = rotate ? await this.store.key(requireId(id)) : undefined;
    return this.store.issue(
      p.id,
      old?.accountId ?? requireId(id),
      key,
      requireAccountName(body['name']),
      parseBindings(body['bindings']),
      expires,
      old?.id,
    );
  }
  revoke(p: Principal, id: string) {
    this.admin(p);
    return this.store.revoke(p.id, requireId(id));
  }
  activate(token: string) {
    return this.store.activate(token);
  }
  audit(p: Principal, id: string, after = '0') {
    this.admin(p);
    if (!/^(0|[1-9][0-9]{0,17})$/.test(after))
      throw new DepotError('invalid_input', 'Invalid audit cursor');
    return this.store.audit(requireId(id), after);
  }
}
