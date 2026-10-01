import { randomBytes, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { ArkvoryError, requireSubset } from '@proanima/arkvory-domain';
import type { ServiceBinding, Principal } from '@proanima/arkvory-domain';
import type { ApiKey, KeyIssue } from '@proanima/arkvory-application';
import { administrationContext, authorizeAdministration } from './delegation-authorization.js';
import type { AdministrationContext } from './delegation-authorization.js';
import { serviceKeyExpiry } from './service-key-expiry.js';
import { account, digest, key } from './service-rows.js';
import type { AccountRow, KeyRow } from './service-rows.js';
import { recordServiceEvent } from './service-transaction.js';

/** `accountId` is the target account, or the source key ID when `rotate` is set. */
export interface KeyIssueRequest {
  accountId: string;
  idempotencyKey: string;
  name: string;
  bindings: readonly ServiceBinding[];
  expiresAt: string | undefined;
  rotate: boolean;
}

/** Parameters that must match when an idempotency key is replayed. */
function issueFingerprint(request: KeyIssueRequest): string {
  return digest(
    JSON.stringify({
      name: request.name,
      bindings: request.bindings,
      expiresAt: request.expiresAt ?? null,
      rotatedFrom: request.rotate ? request.accountId : null,
    }),
  );
}

async function issueTarget(c: PoolClient, request: KeyIssueRequest): Promise<string> {
  if (!request.rotate) return request.accountId;
  return key(
    (await c.query<KeyRow>('SELECT * FROM arkvory_api_keys WHERE id=$1', [request.accountId]))
      .rows[0],
  ).accountId;
}

/** Rotation narrows: the source key must be active and its bindings must cover the new ones. */
async function requireRotationSource(
  c: PoolClient,
  ctx: AdministrationContext,
  request: KeyIssueRequest,
  targetId: string,
  now: Date,
): Promise<void> {
  const old = key(
    (
      await c.query<KeyRow>(
        'SELECT * FROM arkvory_api_keys WHERE id=$1 AND account_id=$2 FOR UPDATE',
        [request.accountId, targetId],
      )
    ).rows[0],
  );
  if (old.state !== 'active' || Date.parse(old.expiresAt) <= now.getTime())
    throw new ArkvoryError('conflict', 'Rotation requires an active key', {
      reason: 'state_conflict',
    });
  await authorizeAdministration(c, ctx, targetId, 'credential.manage', old.bindings);
  requireSubset(request.bindings, old.bindings);
}

async function requireKeyCapacity(c: PoolClient, targetId: string): Promise<void> {
  const counts = (
    await c.query<{ pending: string; total: string }>(
      `SELECT
        count(*) FILTER(WHERE account_id=$1 AND state='pending' AND expires_at>clock_timestamp() AND activation_expires_at>clock_timestamp())::text AS pending,
        count(*)::text AS total FROM arkvory_api_keys`,
      [targetId],
    )
  ).rows[0];
  if (!counts || Number(counts.pending) >= 2 || Number(counts.total) >= 10000)
    throw new ArkvoryError('capacity_exceeded', 'API key capacity reached', {
      reason: 'key_limit',
    });
}

async function insertKey(
  c: PoolClient,
  row: { id: string; secret: string; targetId: string; expires: Date; fingerprint: string },
  request: KeyIssueRequest,
  issuer: string,
  ctx: AdministrationContext,
): Promise<ApiKey> {
  return key(
    (
      await c.query<KeyRow>(
        `INSERT INTO arkvory_api_keys(id,account_id,name,secret_hash,bindings,expires_at,rotated_from,issued_by,idempotency_key,fingerprint,issued_via_key_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [
          row.id,
          row.targetId,
          request.name,
          digest(row.secret),
          JSON.stringify(request.bindings),
          row.expires.toISOString(),
          request.rotate ? request.accountId : null,
          issuer,
          request.idempotencyKey,
          row.fingerprint,
          ctx.bootstrap ? null : ctx.keyId,
        ],
      )
    ).rows[0],
  );
}

/**
 * Issues (or rotates into) a pending key inside the caller's service mutation transaction.
 * Order matters: the target account row is locked FOR UPDATE before the idempotency lookup, so
 * concurrent replays of one key observe the first insert; a replay returns the key without its
 * secret. Bindings must stay within the account (and the rotated key), and the expiry within the
 * issuing delegate's own key lifetime.
 */
export async function issueServiceKey(
  c: PoolClient,
  actor: Principal,
  request: KeyIssueRequest,
): Promise<KeyIssue> {
  const fingerprint = issueFingerprint(request);
  const ctx = await administrationContext(c, actor);
  const targetId = await issueTarget(c, request);
  await authorizeAdministration(c, ctx, targetId, 'credential.manage', request.bindings);
  const a = account(
    (
      await c.query<AccountRow>('SELECT * FROM arkvory_service_accounts WHERE id=$1 FOR UPDATE', [
        targetId,
      ])
    ).rows[0],
  );
  if (!a.enabled)
    throw new ArkvoryError('forbidden', 'Service account disabled', {
      reason: 'credential_revoked',
    });
  const existing = (
    await c.query<KeyRow>(
      'SELECT * FROM arkvory_api_keys WHERE account_id=$1 AND issued_by=$2 AND idempotency_key=$3',
      [targetId, actor.id, request.idempotencyKey],
    )
  ).rows[0];
  if (existing) {
    if (existing.fingerprint !== fingerprint)
      throw new ArkvoryError('conflict', 'Idempotency key has different parameters', {
        reason: 'idempotency_mismatch',
      });
    return { key: key(existing) };
  }
  requireSubset(request.bindings, a.bindings);
  const now = (await c.query<{ now: Date }>('SELECT clock_timestamp() AS now')).rows[0]?.now;
  if (!now) throw new ArkvoryError('unavailable', 'Database time unavailable');
  const expires = serviceKeyExpiry(
    now,
    request.expiresAt,
    ctx.bootstrap ? undefined : ctx.expiresAt,
  );
  if (request.rotate) await requireRotationSource(c, ctx, request, targetId, now);
  await requireKeyCapacity(c, targetId);
  const id = randomUUID();
  const secret = `arkvory_${id}.${randomBytes(32).toString('base64url')}`;
  const row = { id, secret, targetId, expires, fingerprint };
  const issued = await insertKey(c, row, request, actor.id, ctx);
  await recordServiceEvent(c, actor.id, request.rotate ? 'key.rotate' : 'key.issue', targetId, id);
  return { key: issued, secret };
}
