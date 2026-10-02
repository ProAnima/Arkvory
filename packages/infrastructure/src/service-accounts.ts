import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { ArkvoryError } from '@proanima/arkvory-domain';
import type { ServiceBinding, Principal, AdministrationAction } from '@proanima/arkvory-domain';
import type { CredentialRejection, ServiceStore } from '@proanima/arkvory-application';
import { managedPrincipal } from './service-authorization.js';
import type { CredentialRow } from './service-authorization.js';
import { administrationContext, authorizeAdministration } from './delegation-authorization.js';
import { listDelegations, writeDelegation } from './service-delegations.js';
import { account, digest, key, keyRejection, page, tokenId } from './service-rows.js';
import type { AccountRow, KeyRow } from './service-rows.js';
import { recordServiceEvent, serviceTransaction } from './service-transaction.js';
import { issueServiceKey } from './service-key-issue.js';
import { activateServiceKey } from './service-key-activation.js';

/**
 * PostgreSQL service accounts, managed keys and delegations. Every operation runs in one
 * serviceTransaction; control mutations hold the shared administration lock (see there).
 */
export class PostgresServices implements ServiceStore {
  constructor(private readonly pool: Pool) {}
  private change<T>(work: (client: PoolClient) => Promise<T>, mutation = true): Promise<T> {
    return serviceTransaction(this.pool, work, mutation);
  }
  async accounts(actor: Principal, after?: string) {
    return this.change(async (c) => {
      const ctx = await administrationContext(c, actor);
      const rows = await c.query<AccountRow>(
        `SELECT a.* FROM arkvory_service_accounts a WHERE ($1::uuid IS NULL OR a.id>$1)
        AND ($2::boolean OR EXISTS(SELECT 1 FROM arkvory_service_delegations d WHERE d.target_account_id=a.id AND d.key_id=$3 AND d.enabled AND 'service-account.read'=ANY(d.actions))) ORDER BY a.id LIMIT 51`,
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
        (await c.query<AccountRow>('SELECT * FROM arkvory_service_accounts WHERE id=$1', [id]))
          .rows[0],
      );
    }, false);
  }
  async create(actor: Principal, name: string, bindings: readonly ServiceBinding[]) {
    return this.change(async (c) => {
      if (!(await administrationContext(c, actor)).bootstrap)
        throw new ArkvoryError('forbidden', 'Only bootstrap creates accounts', {
          reason: 'permission_missing',
        });
      if (
        Number(
          (await c.query<{ count: string }>('SELECT count(*) FROM arkvory_service_accounts'))
            .rows[0]?.count,
        ) >= 1000
      )
        throw new ArkvoryError('capacity_exceeded', 'Service account limit reached', {
          reason: 'account_limit',
        });
      const a = account(
        (
          await c.query<AccountRow>(
            'INSERT INTO arkvory_service_accounts(id,name,bindings) VALUES($1,$2,$3) RETURNING *',
            [randomUUID(), name, JSON.stringify(bindings)],
          )
        ).rows[0],
      );
      await recordServiceEvent(c, actor.id, 'service.create', a.id);
      return a;
    });
  }
  async update(actor: Principal, id: string, expected: number, enabled: boolean) {
    return this.change(async (c) => {
      const ctx = await administrationContext(c, actor);
      await authorizeAdministration(c, ctx, id, 'service-account.manage');
      const row = account(
        (
          await c.query<AccountRow>(
            'SELECT * FROM arkvory_service_accounts WHERE id=$1 FOR UPDATE',
            [id],
          )
        ).rows[0],
      );
      await authorizeAdministration(c, ctx, id, 'service-account.manage', row.bindings);
      if (row.revision !== expected)
        throw new ArkvoryError('conflict', 'Service revision changed', {
          reason: 'revision_mismatch',
        });
      const result = account(
        (
          await c.query<AccountRow>(
            'UPDATE arkvory_service_accounts SET enabled=$2,revision=revision+1 WHERE id=$1 RETURNING *',
            [id, enabled],
          )
        ).rows[0],
      );
      await recordServiceEvent(c, actor.id, enabled ? 'service.enable' : 'service.disable', id);
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
          await c.query<AccountRow>(
            'SELECT * FROM arkvory_service_accounts WHERE id=$1 FOR UPDATE',
            [id],
          )
        ).rows[0],
      );
      await authorizeAdministration(c, ctx, id, 'policy.manage', row.bindings);
      if (row.revision !== expected)
        throw new ArkvoryError('conflict', 'Service revision changed', {
          reason: 'revision_mismatch',
        });
      const result = account(
        (
          await c.query<AccountRow>(
            'UPDATE arkvory_service_accounts SET bindings=$2,revision=revision+1 WHERE id=$1 RETURNING *',
            [id, JSON.stringify(bindings)],
          )
        ).rows[0],
      );
      await recordServiceEvent(c, actor.id, 'service.policy', id);
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
        (
          await c.query<AccountRow>('SELECT * FROM arkvory_service_accounts WHERE id=$1', [
            accountId,
          ])
        ).rows[0],
      );
      const rows = await c.query<KeyRow>(
        'SELECT * FROM arkvory_api_keys WHERE account_id=$1 AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT 51',
        [accountId, after ?? null],
      );
      return page(rows.rows.map(key), (r) => r.id);
    }, false);
  }
  async key(actor: Principal, id: string) {
    return this.change(async (c) => {
      const ctx = await administrationContext(c, actor);
      const row = key(
        (await c.query<KeyRow>('SELECT * FROM arkvory_api_keys WHERE id=$1', [id])).rows[0],
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
    const request = { accountId, idempotencyKey, name, bindings, expiresAt, rotate };
    return this.change((c) => issueServiceKey(c, actor, request));
  }
  async revoke(actor: Principal, id: string): Promise<void> {
    await this.change(async (c) => {
      const ctx = await administrationContext(c, actor);
      const k = key(
        (await c.query<KeyRow>('SELECT * FROM arkvory_api_keys WHERE id=$1 FOR UPDATE', [id]))
          .rows[0],
      );
      await authorizeAdministration(c, ctx, k.accountId, 'credential.manage', k.bindings);
      if (k.state === 'revoked') return;
      await c.query("UPDATE arkvory_api_keys SET state='revoked' WHERE id=$1", [id]);
      await recordServiceEvent(c, actor.id, 'key.revoke', k.accountId, id);
    });
  }
  async activate(token: string): Promise<void> {
    const id = tokenId(token);
    if (!id)
      throw new ArkvoryError('unauthorized', 'Invalid credential', {
        reason: 'credential_invalid',
      });
    await this.change((c) => activateServiceKey(c, id, token));
  }
  private async credential(id: string, pending = false) {
    return (
      await this.pool.query<CredentialRow>(
        `SELECT k.id,k.account_id,k.secret_hash,k.bindings,a.bindings AS account_bindings
      FROM arkvory_api_keys k JOIN arkvory_service_accounts a ON a.id=k.account_id
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
  /** After resolve refused a key; see keyRejection. */
  rejection(token: string): Promise<CredentialRejection> {
    return keyRejection(this.pool, token);
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
        (
          await c.query<AccountRow>('SELECT * FROM arkvory_service_accounts WHERE id=$1', [
            accountId,
          ])
        ).rows[0],
      );
      const rows = await c.query<{
        sequence: string;
        actor: string;
        action: string;
        account_id: string;
        key_id: string | null;
        occurred_at: Date;
      }>(
        'SELECT sequence::text,actor,action,account_id,key_id,occurred_at FROM arkvory_service_audit WHERE account_id=$1 AND sequence>$2::bigint ORDER BY arkvory_service_audit.sequence LIMIT 100',
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
      await recordServiceEvent(c, actor.id, 'delegation.set', target, keyId);
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
      await recordServiceEvent(c, actor.id, 'delegation.remove', target, keyId);
      return result;
    });
  }
}
