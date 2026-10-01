import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { ArkvoryError } from '@proanima/arkvory-domain';
import type { TokenScope } from '@proanima/arkvory-domain';
import type { CreatedUserToken, SecurityActor, UserToken } from '@proanima/arkvory-application';
import { inTransaction } from './pg-transaction.js';
import { appendSecurityEvent } from './security-audit.js';

const maxActiveTokens = 50;
// Rows written by an older binary during a rolling update may lack expiry; cap them anyway.
const expiry = `COALESCE(t.expires_at,t.created_at+interval '365 days')`;
const live = `(t.revoked_at IS NULL AND ${expiry}>now())`;

function digest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
// Unknown stored values fail closed to the narrower scope.
function scope(value: string): TokenScope {
  return value === 'read-write' ? 'read-write' : 'read';
}
export interface ResolvedUserToken {
  readonly userId: string;
  readonly scope: TokenScope;
}

/** Revokes every personal token of the account inside the caller's transaction. */
export async function revokeAllUserTokens(client: PoolClient, userId: string): Promise<number> {
  const result = await client.query(
    'UPDATE arkvory_user_tokens SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL',
    [userId],
  );
  return result.rowCount ?? 0;
}

export class PostgresUserTokens {
  constructor(private readonly pool: Pool) {}

  async resolve(token: string): Promise<ResolvedUserToken | null> {
    if (!/^pat_[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const result = await this.pool.query<{ id: string; user_id: string; scope: string }>(
      `SELECT t.id,t.user_id,t.scope FROM arkvory_user_tokens t JOIN arkvory_users u ON u.id=t.user_id
       WHERE t.token_hash=$1 AND ${live} AND u.enabled`,
      [digest(token)],
    );
    const row = result.rows[0];
    if (!row) return null;
    void this.pool
      .query('UPDATE arkvory_user_tokens SET last_used_at=now() WHERE id=$1', [row.id])
      .catch(() => undefined);
    return { userId: row.user_id, scope: scope(row.scope) };
  }

  createToken(
    userId: string,
    name: string,
    request: { expiresAt: Date; scope: TokenScope },
    actor: SecurityActor,
  ): Promise<CreatedUserToken> {
    const id = randomUUID();
    const token = 'pat_' + randomBytes(32).toString('base64url');
    const prefix = token.slice(0, 10) + '...';
    return inTransaction(this.pool, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(18471, 10)');
      // Long-dead rows carry no authority; dropping them keeps per-account history bounded.
      await client.query(
        `DELETE FROM arkvory_user_tokens t WHERE t.user_id=$1 AND NOT ${live}
         AND COALESCE(t.revoked_at,${expiry})<now()-interval '30 days'`,
        [userId],
      );
      const active = await client.query<{ count: string }>(
        `SELECT count(*) FROM arkvory_user_tokens t WHERE t.user_id=$1 AND ${live}`,
        [userId],
      );
      if (Number(active.rows[0]?.count ?? 0) >= maxActiveTokens)
        throw new ArkvoryError(
          'capacity_exceeded',
          'User token limit reached (max 50 active tokens)',
        );
      const inserted = await client.query<{ created_at: Date }>(
        `INSERT INTO arkvory_user_tokens(id,user_id,name,token_hash,token_prefix,expires_at,scope)
         VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING created_at`,
        [id, userId, name, digest(token), prefix, request.expiresAt, request.scope],
      );
      const createdAt = inserted.rows[0]?.created_at;
      if (!createdAt) throw new ArkvoryError('unavailable', 'Token creation failed');
      const expiresAt = request.expiresAt.toISOString();
      await appendSecurityEvent(client, actor, {
        action: 'token.create',
        target: `user:${userId}`,
        outcome: 'success',
        details: { tokenId: id, scope: request.scope, expiresAt },
      });
      return {
        id,
        userId,
        name,
        prefix,
        token,
        scope: request.scope,
        createdAt: createdAt.toISOString(),
        expiresAt,
        lastUsedAt: null,
        revoked: false,
      };
    });
  }

  /** Active tokens sort first, so revoked history can never push them out of the page. */
  async tokens(userId: string): Promise<readonly UserToken[]> {
    const result = await this.pool.query<{
      id: string;
      user_id: string;
      name: string;
      token_prefix: string;
      scope: string;
      created_at: Date;
      expires_at: Date;
      last_used_at: Date | null;
      revoked_at: Date | null;
    }>(
      `SELECT t.id,t.user_id,t.name,t.token_prefix,t.scope,t.created_at,${expiry} AS expires_at,
              t.last_used_at,t.revoked_at
       FROM arkvory_user_tokens t WHERE t.user_id=$1
       ORDER BY ${live} DESC,t.created_at DESC,t.id LIMIT 100`,
      [userId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      name: row.name,
      prefix: row.token_prefix,
      scope: scope(row.scope),
      createdAt: row.created_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
      lastUsedAt: row.last_used_at?.toISOString() ?? null,
      revoked: row.revoked_at !== null,
    }));
  }

  /** Idempotent: revoking an already revoked token succeeds without a second audit row. */
  revokeToken(userId: string, tokenId: string, actor: SecurityActor): Promise<void> {
    return inTransaction(this.pool, async (client) => {
      const result = await client.query(
        'UPDATE arkvory_user_tokens SET revoked_at=now() WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL',
        [tokenId, userId],
      );
      if (!result.rowCount) {
        const exists = await client.query(
          'SELECT 1 FROM arkvory_user_tokens WHERE id=$1 AND user_id=$2',
          [tokenId, userId],
        );
        if (!exists.rowCount) throw new ArkvoryError('not_found', 'Token not found');
        return;
      }
      await appendSecurityEvent(client, actor, {
        action: 'token.revoke',
        target: `user:${userId}`,
        outcome: 'success',
        details: { tokenId },
      });
    });
  }
}
