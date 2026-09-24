import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { DepotError, parseBindings, requireSubset } from '@proanima/depot-domain';
import type { ServiceBinding, Principal, AdministrationAction } from '@proanima/depot-domain';
import type { ApiKey, ServiceAccount, ServiceStore } from '@proanima/depot-application';
import { managedPrincipal } from './service-authorization.js';
import type { CredentialRow } from './service-authorization.js';

import { administrationContext, authorizeAdministration } from './delegation-authorization.js';
import type { AdministrationContext } from './delegation-authorization.js';
import { listDelegations, writeDelegation } from './service-delegations.js';
interface AccountRow {
  id: string;
  name: string;
  enabled: boolean;
  revision: number;
  bindings: unknown;
  created_at: Date;
}
interface KeyRow {
  id: string;
  account_id: string;
  name: string;
  state: ApiKey['state'];
  bindings: unknown;
  created_at: Date;
  expires_at: Date;
  activation_expires_at: Date;
  rotated_from: string | null;
  fingerprint: string;
  issued_via_key_id: string | null;
}
function account(row: AccountRow | undefined): ServiceAccount {
  if (!row) throw new DepotError('not_found', 'Service resource not found');
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    revision: row.revision,
    bindings: parseBindings(row.bindings),
    createdAt: row.created_at.toISOString(),
  };
}
function key(row: KeyRow | undefined): ApiKey {
  if (!row) throw new DepotError('not_found', 'Service resource not found');
  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    state: row.state,
    bindings: parseBindings(row.bindings),
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    activationExpiresAt: row.activation_expires_at.toISOString(),
    rotatedFrom: row.rotated_from,
  };
}
function tokenId(token: string): string | undefined {
  return /^dpk_([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.[A-Za-z0-9_-]{43}$/.exec(
    token,
  )?.[1];
}
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
function page<T>(rows: readonly T[], id: (row: T) => string) {
  const items = rows.slice(0, 50);
  const last = items.at(-1);
  return { items, next: rows.length > 50 && last ? id(last) : null };
}
export class PostgresServices implements ServiceStore {
  constructor(private readonly pool: Pool) {}
  private async change<T>(work: (client: PoolClient) => Promise<T>, mutation = true): Promise<T> {
    const client = await this.pool.connect();
    let broken = false;
    try {
      await client.query(mutation ? 'BEGIN' : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      if (mutation) await client.query('SELECT pg_advisory_xact_lock(18471,12)');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        broken = true;
      }
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505')
        throw new DepotError('conflict', 'Service name or credential already exists');
      throw error;
    } finally {
      client.release(broken);
    }
  }
  private async event(
    client: PoolClient,
    actor: string,
    action: string,
    accountId: string,
    keyId?: string,
  ) {
    await client.query(
      'INSERT INTO depot_service_audit(actor,action,account_id,key_id) VALUES($1,$2,$3,$4)',
      [actor, action, accountId, keyId ?? null],
    );
    // Bounded operational history; export before retention removes older events.
    await client.query(`DELETE FROM depot_service_audit WHERE sequence IN
      (SELECT sequence FROM depot_service_audit ORDER BY sequence DESC OFFSET 100000 LIMIT 1000)`);
  }
  async accounts(actor: Principal, after?: string) {
    return this.change(async (c) => {
      const ctx = await administrationContext(c, actor);
      const rows = await c.query<AccountRow>(
        `SELECT a.* FROM depot_service_accounts a WHERE ($1::uuid IS NULL OR a.id>$1)
        AND ($2::boolean OR EXISTS(SELECT 1 FROM depot_service_delegations d WHERE d.target_account_id=a.id AND d.key_id=$3 AND d.enabled AND 'service-account.read'=ANY(d.actions))) ORDER BY a.id LIMIT 51`,
        [after ?? null, ctx.bootstrap, ctx.bootstrap ? null : ctx.keyId],
      );
      return page(rows.rows.map(account), (r) => r.id);
    }, false);
  }
  async account(
    actor: Principal,
    id: string,
    scope: 'service-account.read' | 'policy.read' = 'service-account.read',
  ) {
    return this.change(async (c) => {
      await authorizeAdministration(c, await administrationContext(c, actor), id, scope);
      return account(
        (await c.query<AccountRow>('SELECT * FROM depot_service_accounts WHERE id=$1', [id]))
          .rows[0],
      );
    }, false);
  }
  async create(actor: Principal, name: string, bindings: readonly ServiceBinding[]) {
    return this.change(async (c) => {
      if (!(await administrationContext(c, actor)).bootstrap)
        throw new DepotError('forbidden', 'Only bootstrap creates accounts');
      if (
        Number(
          (await c.query<{ count: string }>('SELECT count(*) FROM depot_service_accounts')).rows[0]
            ?.count,
        ) >= 1000
      )
        throw new DepotError('capacity_exceeded', 'Service account limit reached');
      const a = account(
        (
          await c.query<AccountRow>(
            'INSERT INTO depot_service_accounts(id,name,bindings) VALUES($1,$2,$3) RETURNING *',
            [randomUUID(), name, JSON.stringify(bindings)],
          )
        ).rows[0],
      );
      await this.event(c, actor.id, 'service.create', a.id);
      return a;
    });
  }
  async update(actor: Principal, id: string, expected: number, enabled: boolean) {
    return this.change(async (c) => {
      const ctx = await administrationContext(c, actor);
      await authorizeAdministration(c, ctx, id, 'service-account.manage');
      const row = account(
        (
          await c.query<AccountRow>('SELECT * FROM depot_service_accounts WHERE id=$1 FOR UPDATE', [
            id,
          ])
        ).rows[0],
      );
      await authorizeAdministration(c, ctx, id, 'service-account.manage', row.bindings);
      if (row.revision !== expected) throw new DepotError('conflict', 'Service revision changed');
      const result = account(
        (
          await c.query<AccountRow>(
            'UPDATE depot_service_accounts SET enabled=$2,revision=revision+1 WHERE id=$1 RETURNING *',
            [id, enabled],
          )
        ).rows[0],
      );
      await this.event(c, actor.id, enabled ? 'service.enable' : 'service.disable', id);
      return result;
    });
  }
  async policy(
    actor: Principal,
    id: string,
    expected: number,
    bindings: readonly ServiceBinding[],
  ) {
    return this.change(async (c) => {
      const ctx = await administrationContext(c, actor);
      await authorizeAdministration(c, ctx, id, 'policy.manage', bindings);
      const row = account(
        (
          await c.query<AccountRow>('SELECT * FROM depot_service_accounts WHERE id=$1 FOR UPDATE', [
            id,
          ])
        ).rows[0],
      );
      await authorizeAdministration(c, ctx, id, 'policy.manage', row.bindings);
      if (row.revision !== expected) throw new DepotError('conflict', 'Service revision changed');
      const result = account(
        (
          await c.query<AccountRow>(
            'UPDATE depot_service_accounts SET bindings=$2,revision=revision+1 WHERE id=$1 RETURNING *',
            [id, JSON.stringify(bindings)],
          )
        ).rows[0],
      );
      await this.event(c, actor.id, 'service.policy', id);
      return result;
    });
  }
  async keys(actor: Principal, accountId: string, after?: string) {
    return this.change(async (c) => {
      await authorizeAdministration(
        c,
        await administrationContext(c, actor),
        accountId,
        'credential.read',
      );
      account(
        (await c.query<AccountRow>('SELECT * FROM depot_service_accounts WHERE id=$1', [accountId]))
          .rows[0],
      );
      const rows = await c.query<KeyRow>(
        'SELECT * FROM depot_api_keys WHERE account_id=$1 AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT 51',
        [accountId, after ?? null],
      );
      return page(rows.rows.map(key), (r) => r.id);
    }, false);
  }
  async key(actor: Principal, id: string) {
    return this.change(async (c) => {
      const ctx = await administrationContext(c, actor);
      const row = key(
        (await c.query<KeyRow>('SELECT * FROM depot_api_keys WHERE id=$1', [id])).rows[0],
      );
      await authorizeAdministration(c, ctx, row.accountId, 'credential.read');
      return row;
    }, false);
  }
  async issue(
    actor: Principal,
    accountId: string,
    idempotencyKey: string,
    name: string,
    bindings: readonly ServiceBinding[],
    expiresAt: string | undefined,
    rotate = false,
  ) {
    const fingerprint = digest(
      JSON.stringify({
        name,
        bindings,
        expiresAt: expiresAt ?? null,
        rotatedFrom: rotate ? accountId : null,
      }),
    );
    return this.change(async (c) => {
      const ctx = await administrationContext(c, actor);
      const rotatedFrom = rotate ? accountId : undefined;
      const targetId = rotate
        ? key(
            (await c.query<KeyRow>('SELECT * FROM depot_api_keys WHERE id=$1', [accountId]))
              .rows[0],
          ).accountId
        : accountId;
      await authorizeAdministration(c, ctx, targetId, 'credential.manage', bindings);
      const a = account(
        (
          await c.query<AccountRow>('SELECT * FROM depot_service_accounts WHERE id=$1 FOR UPDATE', [
            targetId,
          ])
        ).rows[0],
      );
      if (!a.enabled) throw new DepotError('forbidden', 'Service account disabled');
      const existing = (
        await c.query<KeyRow>(
          'SELECT * FROM depot_api_keys WHERE account_id=$1 AND issued_by=$2 AND idempotency_key=$3',
          [targetId, actor.id, idempotencyKey],
        )
      ).rows[0];
      if (existing) {
        if (existing.fingerprint !== fingerprint)
          throw new DepotError('conflict', 'Idempotency key has different parameters');
        return { key: key(existing) };
      }
      requireSubset(bindings, a.bindings);
      const now = (await c.query<{ now: Date }>('SELECT clock_timestamp() AS now')).rows[0]?.now;
      if (!now) throw new DepotError('unavailable', 'Database time unavailable');
      const expires =
        expiresAt === undefined
          ? new Date(
              Math.min(
                now.getTime() + 90 * 86400000,
                ctx.bootstrap ? Infinity : ctx.expiresAt.getTime(),
              ),
            )
          : new Date(expiresAt);
      if (
        !Number.isFinite(expires.getTime()) ||
        expires <= now ||
        expires.getTime() > now.getTime() + 365 * 86400000
      )
        throw new DepotError('invalid_input', 'Key expiry must be within 365 days');
      if (!ctx.bootstrap && expires > ctx.expiresAt)
        throw new DepotError('forbidden', 'Issued key cannot outlive operator credential');
      if (rotatedFrom) {
        const old = key(
          (
            await c.query<KeyRow>(
              'SELECT * FROM depot_api_keys WHERE id=$1 AND account_id=$2 FOR UPDATE',
              [rotatedFrom, targetId],
            )
          ).rows[0],
        );
        if (old.state !== 'active' || Date.parse(old.expiresAt) <= now.getTime())
          throw new DepotError('conflict', 'Rotation requires an active key');
        await authorizeAdministration(c, ctx, targetId, 'credential.manage', old.bindings);
        requireSubset(bindings, old.bindings);
      }
      const counts = (
        await c.query<{ pending: string; total: string }>(
          `SELECT
        count(*) FILTER(WHERE account_id=$1 AND state='pending' AND expires_at>clock_timestamp() AND activation_expires_at>clock_timestamp())::text AS pending,
        count(*)::text AS total FROM depot_api_keys`,
          [targetId],
        )
      ).rows[0];
      if (!counts || Number(counts.pending) >= 2 || Number(counts.total) >= 10000)
        throw new DepotError('capacity_exceeded', 'API key capacity reached');
      const id = randomUUID();
      const secret = `dpk_${id}.${randomBytes(32).toString('base64url')}`;
      const issued = key(
        (
          await c.query<KeyRow>(
            `INSERT INTO depot_api_keys(id,account_id,name,secret_hash,bindings,expires_at,rotated_from,issued_by,idempotency_key,fingerprint,issued_via_key_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
            [
              id,
              targetId,
              name,
              digest(secret),
              JSON.stringify(bindings),
              expires.toISOString(),
              rotatedFrom ?? null,
              actor.id,
              idempotencyKey,
              fingerprint,
              ctx.bootstrap ? null : ctx.keyId,
            ],
          )
        ).rows[0],
      );
      await this.event(c, actor.id, rotatedFrom ? 'key.rotate' : 'key.issue', targetId, id);
      return { key: issued, secret };
    });
  }
  async revoke(actor: Principal, id: string): Promise<void> {
    await this.change(async (c) => {
      const ctx = await administrationContext(c, actor);
      const k = key(
        (await c.query<KeyRow>('SELECT * FROM depot_api_keys WHERE id=$1 FOR UPDATE', [id]))
          .rows[0],
      );
      await authorizeAdministration(c, ctx, k.accountId, 'credential.manage', k.bindings);
      if (k.state === 'revoked') return;
      await c.query("UPDATE depot_api_keys SET state='revoked' WHERE id=$1", [id]);
      await this.event(c, actor.id, 'key.revoke', k.accountId, id);
    });
  }
  async activate(token: string): Promise<void> {
    const id = tokenId(token);
    if (!id) throw new DepotError('unauthorized', 'Invalid credential');
    await this.change(async (c) => {
      const row = (
        await c.query<
          KeyRow & { secret_hash: string; account_bindings: unknown; enabled: boolean }
        >(
          `SELECT k.*,a.bindings AS account_bindings,a.enabled FROM depot_api_keys k JOIN depot_service_accounts a ON a.id=k.account_id
         WHERE k.id=$1 AND k.expires_at>clock_timestamp() AND (k.state='active' OR (k.state='pending' AND k.activation_expires_at>clock_timestamp()))
         FOR UPDATE OF a,k`,
          [id],
        )
      ).rows[0];
      if (
        !row ||
        !row.enabled ||
        !timingSafeEqual(Buffer.from(row.secret_hash, 'hex'), Buffer.from(digest(token), 'hex'))
      )
        throw new DepotError('unauthorized', 'Invalid credential');
      if (row.state === 'active') return;
      let issuerContext: AdministrationContext | undefined;
      if (row.issued_via_key_id) {
        const issuer = (
          await c.query<{ account_id: string }>(
            'SELECT account_id FROM depot_api_keys WHERE id=$1',
            [row.issued_via_key_id],
          )
        ).rows[0];
        if (!issuer) throw new DepotError('forbidden', 'Issuing operator unavailable');
        const ctx = await administrationContext(c, {
          id: 'service:' + issuer.account_id,
          repositories: [],
          permissions: [],
          managed: { accountId: issuer.account_id, keyId: row.issued_via_key_id, bindings: [] },
        });
        await authorizeAdministration(
          c,
          ctx,
          row.account_id,
          'credential.manage',
          parseBindings(row.bindings),
        );
        issuerContext = ctx;
      }
      requireSubset(parseBindings(row.bindings), parseBindings(row.account_bindings));
      const count = await c.query<{ count: string }>(
        "SELECT count(*) FROM depot_api_keys WHERE account_id=$1 AND state='active' AND expires_at>clock_timestamp()",
        [row.account_id],
      );
      if (Number(count.rows[0]?.count) >= 3)
        throw new DepotError('capacity_exceeded', 'Active key limit reached');
      if (row.rotated_from) {
        const old = (
          await c.query<KeyRow>(
            "SELECT * FROM depot_api_keys WHERE id=$1 AND state='active' AND expires_at>clock_timestamp() FOR UPDATE",
            [row.rotated_from],
          )
        ).rows[0];
        if (!old) throw new DepotError('conflict', 'Source key no longer active');
        if (issuerContext)
          await authorizeAdministration(
            c,
            issuerContext,
            row.account_id,
            'credential.manage',
            parseBindings(old.bindings),
          );
        requireSubset(parseBindings(row.bindings), parseBindings(old.bindings));
        await c.query(
          "UPDATE depot_api_keys SET expires_at=LEAST(expires_at,clock_timestamp()+interval '24 hours') WHERE id=$1",
          [row.rotated_from],
        );
      }
      await c.query(
        "UPDATE depot_api_keys SET state='active',expires_at=LEAST(expires_at,COALESCE($2::timestamptz,expires_at)) WHERE id=$1",
        [id, issuerContext && !issuerContext.bootstrap ? issuerContext.expiresAt : null],
      );
      await this.event(c, `service:${row.account_id}`, 'key.activate', row.account_id, id);
    });
  }
  private async credential(id: string, pending = false) {
    return (
      await this.pool.query<CredentialRow>(
        `SELECT k.id,k.account_id,k.secret_hash,k.bindings,a.bindings AS account_bindings
      FROM depot_api_keys k JOIN depot_service_accounts a ON a.id=k.account_id
      WHERE k.id=$1 AND a.enabled AND k.expires_at>clock_timestamp()
      AND (k.state='active' OR ($2 AND k.state='pending' AND k.activation_expires_at>clock_timestamp()))`,
        [id, pending],
      )
    ).rows[0];
  }
  async resolve(token: string, pending = false) {
    const id = tokenId(token);
    if (!id) return null;
    const row = await this.credential(id, pending);
    if (
      !row ||
      !timingSafeEqual(Buffer.from(row.secret_hash, 'hex'), Buffer.from(digest(token), 'hex'))
    )
      return null;
    return managedPrincipal(row);
  }
  async principalForKey(id: string) {
    const row = await this.credential(id);
    return row ? managedPrincipal(row) : null;
  }
  async audit(actor: Principal, accountId: string, after: string) {
    return this.change(async (c) => {
      await authorizeAdministration(
        c,
        await administrationContext(c, actor),
        accountId,
        'service-audit.read',
      );
      account(
        (await c.query<AccountRow>('SELECT * FROM depot_service_accounts WHERE id=$1', [accountId]))
          .rows[0],
      );
      const rows = await c.query<{
        sequence: string;
        actor: string;
        action: string;
        account_id: string;
        key_id: string | null;
        occurred_at: Date;
      }>(
        'SELECT sequence::text,actor,action,account_id,key_id,occurred_at FROM depot_service_audit WHERE account_id=$1 AND sequence>$2::bigint ORDER BY sequence LIMIT 100',
        [accountId, after],
      );
      return rows.rows.map((r) => ({
        sequence: r.sequence,
        actor: r.actor,
        action: r.action,
        accountId: r.account_id,
        keyId: r.key_id,
        occurredAt: r.occurred_at.toISOString(),
      }));
    }, false);
  }
  delegations(actor: Principal, keyId: string) {
    return this.change(
      async (c) => listDelegations(c, await administrationContext(c, actor), keyId),
      false,
    );
  }
  setDelegation(
    actor: Principal,
    keyId: string,
    target: string,
    expected: number,
    actions: readonly AdministrationAction[],
    ceiling: readonly ServiceBinding[],
  ) {
    return this.change(async (c) => {
      const result = await writeDelegation(
        c,
        await administrationContext(c, actor),
        keyId,
        target,
        expected,
        { actions, ceiling },
      );
      await this.event(c, actor.id, 'delegation.set', target, keyId);
      return result;
    });
  }
  removeDelegation(actor: Principal, keyId: string, target: string, expected: number) {
    return this.change(async (c) => {
      const result = await writeDelegation(
        c,
        await administrationContext(c, actor),
        keyId,
        target,
        expected,
      );
      await this.event(c, actor.id, 'delegation.remove', target, keyId);
      return result;
    });
  }
}
