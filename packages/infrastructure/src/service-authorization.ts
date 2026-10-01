import { ArkvoryError, intersectBindings, parseBindings, allows } from '@proanima/arkvory-domain';
import type { MutationAccess, Principal } from '@proanima/arkvory-domain';
import type { PoolClient } from 'pg';

export interface CredentialRow {
  id: string;
  account_id: string;
  secret_hash: string;
  bindings: unknown;
  account_bindings: unknown;
}
export function managedPrincipal(row: CredentialRow): Principal {
  return {
    id: `service:${row.account_id}`,
    credential: 'service-key',
    repositories: [],
    permissions: [],
    managed: {
      accountId: row.account_id,
      keyId: row.id,
      bindings: intersectBindings(parseBindings(row.account_bindings), parseBindings(row.bindings)),
    },
  };
}
/** Issuing operator for activation checks; its authority comes from delegations, not bindings. */
export function issuerPrincipal(accountId: string, keyId: string): Principal {
  return {
    id: `service:${accountId}`,
    credential: 'service-key',
    repositories: [],
    permissions: [],
    managed: { accountId, keyId, bindings: [] },
  };
}
// Caller MUST have an open, short transaction. Revocation/policy changes conflict with these locks.
export async function lockServiceAccess(
  client: PoolClient,
  access: MutationAccess | undefined,
): Promise<void> {
  const credential = access?.principal.managed;
  if (!credential) return;
  const result = await client.query<CredentialRow>(
    `SELECT k.id,k.account_id,k.secret_hash,k.bindings,a.bindings AS account_bindings
     FROM arkvory_service_accounts a JOIN arkvory_api_keys k ON k.account_id=a.id
     WHERE a.id=$1 AND k.id=$2 AND a.enabled AND k.state='active'
       AND k.expires_at>clock_timestamp() FOR SHARE OF a,k`,
    [credential.accountId, credential.keyId],
  );
  const row = result.rows[0];
  if (!row || access.principal.id !== `service:${row.account_id}`)
    throw new ArkvoryError('forbidden', 'Service credential revoked or expired');
  const bindings = intersectBindings(
    parseBindings(row.account_bindings),
    parseBindings(row.bindings),
  );
  if (access.actions.some((action) => !allows(bindings, access.repository, action)))
    throw new ArkvoryError('forbidden', 'Service policy changed');
}
