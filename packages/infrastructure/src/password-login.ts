import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  ArkvoryError,
  ThrottledError,
  drainedLoginDebt,
  loginBackoffMs,
} from '@proanima/arkvory-domain';
import type { LoginResult, SecurityActor } from '@proanima/arkvory-application';
import { inTransaction } from './pg-transaction.js';
import { appendSecurityEvent } from './security-audit.js';
import { revokeAllUserTokens } from './user-tokens.js';

const dummySalt = '0'.repeat(32);
export function sessionDigest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
export function passwordHash(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      Buffer.from(salt, 'hex'),
      64,
      { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 ** 2 },
      (error, derived) => {
        if (error) reject(error);
        else resolve(derived);
      },
    );
  });
}

interface CredentialRow {
  id: string;
  name: string;
  administrator: boolean;
  password_salt: string;
  password_hash: string;
  enabled: boolean;
  login_debt: number;
  locked_ms: number;
  elapsed_ms: number | null;
}
// Database time only: several API processes share one backoff state without clock agreement.
const credentialColumns = `id,name,administrator,password_salt,password_hash,enabled,login_debt,
  GREATEST(0,EXTRACT(EPOCH FROM (locked_until-now()))*1000)::float8 AS locked_ms,
  (EXTRACT(EPOCH FROM (now()-login_debt_at))*1000)::float8 AS elapsed_ms`;

async function verify(row: CredentialRow | undefined, password: string): Promise<boolean> {
  // Unknown accounts still pay for one hash so response time does not reveal account names.
  const candidate = await passwordHash(password, row?.password_salt ?? dummySalt);
  const stored = row ? Buffer.from(row.password_hash, 'hex') : Buffer.alloc(64);
  return (
    row !== undefined && stored.length === candidate.length && timingSafeEqual(candidate, stored)
  );
}
function refuseDuringBackoff(row: CredentialRow | undefined): void {
  // Checked before hashing: a blocked attempt costs no CPU and adds no debt.
  if (row && row.locked_ms > 0)
    throw new ThrottledError(Math.max(1, Math.ceil(row.locked_ms / 1000)));
}
async function recordWrongPassword(client: PoolClient, row: CredentialRow): Promise<void> {
  const debt = drainedLoginDebt(row.login_debt, row.elapsed_ms ?? Number.POSITIVE_INFINITY) + 1;
  const delayMs = loginBackoffMs(debt);
  await client.query(
    `UPDATE arkvory_users SET login_debt=$2,login_debt_at=now(),
     locked_until=CASE WHEN $3::float8>0 THEN now()+make_interval(secs=>$3::float8/1000) ELSE NULL END
     WHERE id=$1`,
    [row.id, debt, delayMs],
  );
}
const clearBackoff = 'failed_logins=0,locked_until=NULL,login_debt=0,login_debt_at=NULL';

/** Failures commit their backoff and audit rows before the caller sees `unauthorized`. */
export async function passwordLogin(
  pool: Pool,
  name: string,
  password: string,
  actor: SecurityActor,
): Promise<LoginResult> {
  const result = await inTransaction(pool, async (client) => {
    const row = (
      await client.query<CredentialRow>(
        `SELECT ${credentialColumns} FROM arkvory_users WHERE lower(name)=lower($1) FOR UPDATE`,
        [name],
      )
    ).rows[0];
    refuseDuringBackoff(row);
    const matched = await verify(row, password);
    if (!row || !row.enabled || !matched) {
      if (row && !matched) await recordWrongPassword(client, row);
      await appendSecurityEvent(client, actor, {
        action: 'auth.login',
        target: row ? `user:${row.id}` : name,
        outcome: 'failure',
        code: !row ? 'unknown_account' : matched ? 'account_disabled' : 'invalid_password',
      });
      return null;
    }
    await client.query(`UPDATE arkvory_users SET ${clearBackoff} WHERE id=$1`, [row.id]);
    await client.query(
      `DELETE FROM arkvory_user_sessions WHERE user_id=$1 AND
       (expires_at<=now() OR token_hash IN (
         SELECT token_hash FROM arkvory_user_sessions WHERE user_id=$1 AND expires_at>now()
         ORDER BY created_at DESC,token_hash DESC OFFSET 31
       ))`,
      [row.id],
    );
    const token = 'dps_' + randomBytes(32).toString('base64url');
    const session = await client.query<{ expires_at: Date }>(
      `INSERT INTO arkvory_user_sessions(token_hash,user_id,expires_at)
       VALUES($1,$2,now()+interval '12 hours') RETURNING expires_at`,
      [sessionDigest(token), row.id],
    );
    const expiresAt = session.rows[0]?.expires_at;
    if (!expiresAt) throw new ArkvoryError('unavailable', 'Session creation failed');
    await appendSecurityEvent(
      client,
      { ...actor, id: `user:${row.id}` },
      { action: 'auth.login', target: `user:${row.id}`, outcome: 'success' },
    );
    return {
      token,
      expiresAt: expiresAt.toISOString(),
      account: { id: row.id, name: row.name, administrator: row.administrator, enabled: true },
    };
  });
  if (!result) throw new ArkvoryError('unauthorized', 'Invalid credentials');
  return result;
}

/** Revokes all sessions and personal tokens; wrong current passwords feed the same backoff. */
export async function changeOwnPassword(
  pool: Pool,
  userId: string,
  currentPassword: string,
  newPassword: string,
  actor: SecurityActor,
): Promise<void> {
  const changed = await inTransaction(pool, async (client) => {
    const row = (
      await client.query<CredentialRow>(
        `SELECT ${credentialColumns} FROM arkvory_users WHERE id=$1 FOR UPDATE`,
        [userId],
      )
    ).rows[0];
    refuseDuringBackoff(row);
    const matched = await verify(row, currentPassword);
    if (!row?.enabled || !matched) {
      if (row && !matched) await recordWrongPassword(client, row);
      await appendSecurityEvent(client, actor, {
        action: 'auth.password.change',
        target: `user:${userId}`,
        outcome: 'failure',
        code: matched ? 'account_disabled' : 'invalid_password',
      });
      return false;
    }
    const salt = randomBytes(16).toString('hex');
    const hash = (await passwordHash(newPassword, salt)).toString('hex');
    await client.query(
      `UPDATE arkvory_users SET password_salt=$2,password_hash=$3,${clearBackoff} WHERE id=$1`,
      [userId, salt, hash],
    );
    await client.query('DELETE FROM arkvory_user_sessions WHERE user_id=$1', [userId]);
    const revokedTokens = await revokeAllUserTokens(client, userId);
    await appendSecurityEvent(client, actor, {
      action: 'auth.password.change',
      target: `user:${userId}`,
      outcome: 'success',
      details: { revokedTokens },
    });
    return true;
  });
  if (!changed) throw new ArkvoryError('unauthorized', 'Invalid credentials');
}
