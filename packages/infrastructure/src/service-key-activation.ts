import { timingSafeEqual } from 'node:crypto';
import type { PoolClient } from 'pg';
import { ArkvoryError, parseBindings, requireSubset } from '@proanima/arkvory-domain';
import { administrationContext, authorizeAdministration } from './delegation-authorization.js';
import type { AdministrationContext } from './delegation-authorization.js';
import { issuerPrincipal } from './service-authorization.js';
import { digest } from './service-rows.js';
import type { KeyRow } from './service-rows.js';
import { recordServiceEvent } from './service-transaction.js';

type ActivationRow = KeyRow & { secret_hash: string; account_bindings: unknown; enabled: boolean };

/**
 * A key issued by a delegate is activated only while that delegate may still manage the target;
 * the delegate's context also caps the activated key's expiry. Bootstrap-issued keys skip this.
 */
async function issuerContext(
  c: PoolClient,
  row: ActivationRow,
): Promise<AdministrationContext | undefined> {
  if (!row.issued_via_key_id) return undefined;
  const issuer = (
    await c.query<{ account_id: string }>('SELECT account_id FROM arkvory_api_keys WHERE id=$1', [
      row.issued_via_key_id,
    ])
  ).rows[0];
  if (!issuer)
    throw new ArkvoryError('forbidden', 'Issuing operator unavailable', {
      reason: 'credential_revoked',
    });
  const operator = issuerPrincipal(issuer.account_id, row.issued_via_key_id);
  const ctx = await administrationContext(c, operator);
  await authorizeAdministration(
    c,
    ctx,
    row.account_id,
    'credential.manage',
    parseBindings(row.bindings),
  );
  return ctx;
}

/** The rotated source stays usable for at most 24 hours after its replacement is activated. */
async function retireRotationSource(
  c: PoolClient,
  row: ActivationRow,
  rotatedFrom: string,
  ctx: AdministrationContext | undefined,
): Promise<void> {
  const old = (
    await c.query<KeyRow>(
      "SELECT * FROM arkvory_api_keys WHERE id=$1 AND state='active' AND expires_at>clock_timestamp() FOR UPDATE",
      [rotatedFrom],
    )
  ).rows[0];
  if (!old)
    throw new ArkvoryError('conflict', 'Source key no longer active', { reason: 'state_conflict' });
  if (ctx)
    await authorizeAdministration(
      c,
      ctx,
      row.account_id,
      'credential.manage',
      parseBindings(old.bindings),
    );
  requireSubset(parseBindings(row.bindings), parseBindings(old.bindings));
  await c.query(
    "UPDATE arkvory_api_keys SET expires_at=LEAST(expires_at,clock_timestamp()+interval '24 hours') WHERE id=$1",
    [rotatedFrom],
  );
}

/**
 * Activates a pending key by its own secret inside the caller's service mutation transaction.
 * Account and key rows are locked FOR UPDATE first; repeating activation of an active key is a
 * no-op. Every failure to prove the secret is reported as the same `unauthorized` error.
 */
export async function activateServiceKey(c: PoolClient, id: string, token: string): Promise<void> {
  const row = (
    await c.query<ActivationRow>(
      `SELECT k.*,a.bindings AS account_bindings,a.enabled FROM arkvory_api_keys k JOIN arkvory_service_accounts a ON a.id=k.account_id
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
    throw new ArkvoryError('unauthorized', 'Invalid credential', { reason: 'credential_invalid' });
  if (row.state === 'active') return;
  const ctx = await issuerContext(c, row);
  requireSubset(parseBindings(row.bindings), parseBindings(row.account_bindings));
  const count = await c.query<{ count: string }>(
    "SELECT count(*) FROM arkvory_api_keys WHERE account_id=$1 AND state='active' AND expires_at>clock_timestamp()",
    [row.account_id],
  );
  if (Number(count.rows[0]?.count) >= 3)
    throw new ArkvoryError('capacity_exceeded', 'Active key limit reached', {
      reason: 'key_limit',
    });
  if (row.rotated_from) await retireRotationSource(c, row, row.rotated_from, ctx);
  await c.query(
    "UPDATE arkvory_api_keys SET state='active',expires_at=LEAST(expires_at,COALESCE($2::timestamptz,expires_at)) WHERE id=$1",
    [id, ctx && !ctx.bootstrap ? ctx.expiresAt : null],
  );
  await recordServiceEvent(c, `service:${row.account_id}`, 'key.activate', row.account_id, id);
}
