import { ArkvoryError, parseBindings, requireSubset } from '@proanima/arkvory-domain';
import type { AdministrationAction, Principal, ServiceBinding } from '@proanima/arkvory-domain';
import type { PoolClient } from 'pg';

export type AdministrationContext =
  | { bootstrap: true }
  | {
      bootstrap: false;
      keyId: string;
      accountId: string;
      expiresAt: Date;
    };
// Control mutations MUST hold advisory xact lock 18471/12; reads use a single snapshot.
export async function administrationContext(
  c: PoolClient,
  p: Principal,
): Promise<AdministrationContext> {
  if (!p.managed && p.serviceAdministrator === true) return { bootstrap: true };
  if (!p.managed) throw new ArkvoryError('forbidden', 'Service administration denied');
  const row = (
    await c.query<{ account_id: string; expires_at: Date }>(
      `SELECT k.account_id,k.expires_at FROM depot_api_keys k JOIN depot_service_accounts a ON a.id=k.account_id
     WHERE k.id=$1 AND k.account_id=$2 AND k.state='active' AND a.enabled AND k.expires_at>clock_timestamp()`,
      [p.managed.keyId, p.managed.accountId],
    )
  ).rows[0];
  if (!row || p.id !== `service:${row.account_id}`)
    throw new ArkvoryError('forbidden', 'Operator credential revoked or expired');
  return {
    bootstrap: false,
    keyId: p.managed.keyId,
    accountId: row.account_id,
    expiresAt: row.expires_at,
  };
}
export async function authorizeAdministration(
  c: PoolClient,
  context: AdministrationContext,
  target: string,
  action: AdministrationAction,
  bindings?: readonly ServiceBinding[],
): Promise<void> {
  if (context.bootstrap) return;
  if (target === context.accountId)
    throw new ArkvoryError('forbidden', 'Self administration is not delegated');
  const grant = (
    await c.query<{ actions: string[]; ceiling: unknown }>(
      'SELECT actions,ceiling FROM depot_service_delegations WHERE key_id=$1 AND target_account_id=$2 AND enabled',
      [context.keyId, target],
    )
  ).rows[0];
  if (!grant) throw new ArkvoryError('not_found', 'Service resource not found');
  if (!grant.actions.includes(action))
    throw new ArkvoryError('forbidden', 'Administration action denied');
  if (bindings) requireSubset(bindings, parseBindings(grant.ceiling));
}
