import { ArkvoryError, parseBindings, parseAdministrationActions } from '@proanima/arkvory-domain';
import type {
  AdministrationAction,
  ServiceBinding,
  ServiceDelegation,
} from '@proanima/arkvory-domain';
import type { PoolClient } from 'pg';
import type { AdministrationContext } from './delegation-authorization.js';
interface GrantRow {
  key_id: string;
  target_account_id: string;
  revision: number;
  enabled: boolean;
  actions: unknown;
  ceiling: unknown;
}
const decode = (r: GrantRow): ServiceDelegation => ({
  keyId: r.key_id,
  targetAccountId: r.target_account_id,
  revision: r.revision,
  enabled: r.enabled,
  actions: r.enabled ? parseAdministrationActions(r.actions) : [],
  ceiling: parseBindings(r.ceiling),
});
export async function listDelegations(c: PoolClient, ctx: AdministrationContext, keyId: string) {
  if (!ctx.bootstrap && ctx.keyId !== keyId)
    throw new ArkvoryError('forbidden', 'Only own delegations may be read');
  if (!(await c.query('SELECT 1 FROM depot_api_keys WHERE id=$1', [keyId])).rowCount)
    throw new ArkvoryError('not_found', 'API key not found');
  return (
    await c.query<GrantRow>(
      'SELECT * FROM depot_service_delegations WHERE key_id=$1 ORDER BY target_account_id LIMIT 64',
      [keyId],
    )
  ).rows.map(decode);
}
export async function writeDelegation(
  c: PoolClient,
  ctx: AdministrationContext,
  keyId: string,
  target: string,
  expected: number,
  value?: { actions: readonly AdministrationAction[]; ceiling: readonly ServiceBinding[] },
) {
  if (!ctx.bootstrap) throw new ArkvoryError('forbidden', 'Only bootstrap may delegate');
  const existing = (
    await c.query<GrantRow>(
      'SELECT * FROM depot_service_delegations WHERE key_id=$1 AND target_account_id=$2',
      [keyId, target],
    )
  ).rows[0];
  if ((existing?.revision ?? 0) !== expected)
    throw new ArkvoryError('conflict', 'Delegation revision changed');
  if (!value && !existing) throw new ArkvoryError('not_found', 'Delegation not found');
  if (value) {
    const operator = (
      await c.query<{ account_id: string }>(
        `SELECT k.account_id FROM depot_api_keys k JOIN depot_service_accounts a ON a.id=k.account_id
      WHERE k.id=$1 AND a.enabled AND k.state='active' AND k.expires_at>clock_timestamp() AND k.issued_via_key_id IS NULL`,
        [keyId],
      )
    ).rows[0];
    if (!operator)
      throw new ArkvoryError('conflict', 'Delegate requires an active bootstrap-issued credential');
    if (operator.account_id === target)
      throw new ArkvoryError('forbidden', 'Self administration is not delegated');
    if (!(await c.query('SELECT 1 FROM depot_service_accounts WHERE id=$1', [target])).rowCount)
      throw new ArkvoryError('not_found', 'Target account not found');
    // No chains: an account cannot simultaneously be a delegated target and an operator.
    if (
      (
        await c.query(
          `SELECT 1 FROM depot_service_delegations d JOIN depot_api_keys k ON k.id=d.key_id
      WHERE d.enabled AND (d.target_account_id=$1 OR k.account_id=$2) LIMIT 1`,
          [operator.account_id, target],
        )
      ).rowCount
    )
      throw new ArkvoryError('conflict', 'Operator accounts cannot be delegated targets');
  }
  if (!existing) {
    const counts = (
      await c.query<{ total: string; owned: string }>(
        `SELECT count(*)::text AS total, count(*) FILTER(WHERE key_id=$1)::text AS owned FROM depot_service_delegations`,
        [keyId],
      )
    ).rows[0];
    if (!counts || Number(counts.total) >= 10000 || Number(counts.owned) >= 64)
      throw new ArkvoryError('capacity_exceeded', 'Delegation capacity reached');
  }
  const row = (
    await c.query<GrantRow>(
      `INSERT INTO depot_service_delegations(key_id,target_account_id,revision,enabled,actions,ceiling)
    VALUES($1,$2,1,$3,$4,$5) ON CONFLICT(key_id,target_account_id) DO UPDATE
    SET revision=depot_service_delegations.revision+1,enabled=excluded.enabled,actions=excluded.actions,ceiling=excluded.ceiling RETURNING *`,
      [
        keyId,
        target,
        value !== undefined,
        value?.actions ?? [],
        JSON.stringify(value?.ceiling ?? []),
      ],
    )
  ).rows[0];
  if (!row) throw new ArkvoryError('unavailable', 'Delegation update failed');
  return decode(row);
}
