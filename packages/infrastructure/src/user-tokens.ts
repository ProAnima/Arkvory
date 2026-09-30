import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { ArkvoryError } from '@proanima/arkvory-domain';
import type { CreatedUserToken, UserToken } from '@proanima/arkvory-application';

function digest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export class PostgresUserTokens {
  constructor(private readonly pool: Pool) {}

  async resolve(token: string): Promise<string | null> {
    if (!/^pat_[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const result = await this.pool.query<{ id: string; user_id: string }>(
      `SELECT t.id, u.id AS user_id FROM arkvory_user_tokens t JOIN arkvory_users u ON u.id=t.user_id
       WHERE t.token_hash=$1 AND t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at>now()) AND u.enabled`,
      [digest(token)],
    );
    const row = result.rows[0];
    if (!row) return null;
    void this.pool
      .query('UPDATE arkvory_user_tokens SET last_used_at=now() WHERE id=$1', [row.id])
      .catch(() => undefined);
    return row.user_id;
  }

  async createToken(userId: string, name: string, expiresAt?: string): Promise<CreatedUserToken> {
    const id = randomUUID();
    const token = 'pat_' + randomBytes(32).toString('base64url');
    const tokenHash = digest(token);
    const prefix = token.slice(0, 10) + '...';
    const expiresDate = expiresAt ? new Date(expiresAt) : null;
    if (expiresDate && !Number.isFinite(expiresDate.getTime()))
      throw new ArkvoryError('invalid_input', 'Invalid expiration date');
    const client = await this.pool.connect();
    let broken = false;
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(18471, 10)');
      const activeCount = await client.query<{ count: string }>(
        'SELECT count(*) FROM arkvory_user_tokens WHERE user_id=$1 AND revoked_at IS NULL',
        [userId],
      );
      if (Number(activeCount.rows[0]?.count ?? 0) >= 50)
        throw new ArkvoryError(
          'capacity_exceeded',
          'User token limit reached (max 50 active tokens)',
        );
      const res = await client.query<{ created_at: Date }>(
        `INSERT INTO arkvory_user_tokens(id, user_id, name, token_hash, token_prefix, expires_at)
         VALUES($1, $2, $3, $4, $5, $6) RETURNING created_at`,
        [id, userId, name, tokenHash, prefix, expiresDate],
      );
      if (!res.rows[0]) throw new ArkvoryError('unavailable', 'Token creation failed');
      await client.query('COMMIT');
      return {
        id,
        userId,
        name,
        prefix,
        token,
        createdAt: res.rows[0].created_at.toISOString(),
        expiresAt: expiresDate ? expiresDate.toISOString() : null,
        lastUsedAt: null,
        revoked: false,
      };
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        broken = true;
      }
      throw error;
    } finally {
      client.release(broken);
    }
  }

  async tokens(userId: string): Promise<readonly UserToken[]> {
    const result = await this.pool.query<{
      id: string;
      user_id: string;
      name: string;
      token_prefix: string;
      created_at: Date;
      expires_at: Date | null;
      last_used_at: Date | null;
      revoked_at: Date | null;
    }>(
      `SELECT id, user_id, name, token_prefix, created_at, expires_at, last_used_at, revoked_at
       FROM arkvory_user_tokens WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50`,
      [userId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      name: row.name,
      prefix: row.token_prefix,
      createdAt: row.created_at.toISOString(),
      expiresAt: row.expires_at?.toISOString() ?? null,
      lastUsedAt: row.last_used_at?.toISOString() ?? null,
      revoked: row.revoked_at !== null,
    }));
  }

  async revokeToken(userId: string, tokenId: string): Promise<void> {
    const result = await this.pool.query(
      'UPDATE arkvory_user_tokens SET revoked_at=now() WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL',
      [tokenId, userId],
    );
    if (!result.rowCount) {
      const exists = await this.pool.query(
        'SELECT 1 FROM arkvory_user_tokens WHERE id=$1 AND user_id=$2',
        [tokenId, userId],
      );
      if (!exists.rowCount) throw new ArkvoryError('not_found', 'Token not found');
    }
  }
}
