import { createHash, timingSafeEqual } from 'node:crypto';
import type { Pool } from 'pg';
import { ArkvoryError, parseBindings } from '@proanima/arkvory-domain';
import type { ApiKey, CredentialRejection, ServiceAccount } from '@proanima/arkvory-application';

export interface AccountRow {
  id: string;
  name: string;
  enabled: boolean;
  revision: number;
  bindings: unknown;
  created_at: Date;
}
export interface KeyRow {
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
/** A missing row is reported as not_found; stored bindings are re-validated on every read. */
export function account(row: AccountRow | undefined): ServiceAccount {
  if (!row) throw new ArkvoryError('not_found', 'Service resource not found');
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    revision: row.revision,
    bindings: parseBindings(row.bindings),
    createdAt: row.created_at.toISOString(),
  };
}
export function key(row: KeyRow | undefined): ApiKey {
  if (!row) throw new ArkvoryError('not_found', 'Service resource not found');
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
/** Key ID embedded in a managed secret; only the SHA-256 of the whole secret is stored. */
export function tokenId(token: string): string | undefined {
  return /^arkvory_([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.[A-Za-z0-9_-]{43}$/.exec(
    token,
  )?.[1];
}
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
/** Callers query 51 rows; the 51st only signals that another page exists. */
export function page<T>(rows: readonly T[], id: (row: T) => string) {
  const items = rows.slice(0, 50);
  const last = items.at(-1);
  return { items, next: rows.length > 50 && last ? id(last) : null };
}

/**
 * token_expired only when the exact secret of an active key of an enabled account matches,
 * so a guessed key id learns nothing; everything else is credential_invalid.
 */
export async function keyRejection(pool: Pool, token: string): Promise<CredentialRejection> {
  const id = tokenId(token);
  if (!id) return 'credential_invalid';
  const row = (
    await pool.query<{ secret_hash: string; expired: boolean }>(
      `SELECT k.secret_hash,k.expires_at<=clock_timestamp() AS expired FROM arkvory_api_keys k
       JOIN arkvory_service_accounts a ON a.id=k.account_id
       WHERE k.id=$1 AND a.enabled AND k.state='active'`,
      [id],
    )
  ).rows[0];
  if (!row) return 'credential_invalid';
  const matches = timingSafeEqual(
    Buffer.from(row.secret_hash, 'hex'),
    Buffer.from(digest(token), 'hex'),
  );
  return matches && row.expired ? 'token_expired' : 'credential_invalid';
}
