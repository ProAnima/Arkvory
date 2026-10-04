import { randomBytes, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { ArkvoryError } from '@proanima/arkvory-domain';
import type { CredentialKind, Principal, TokenScope } from '@proanima/arkvory-domain';
import { PostgresUserTokens, revokeAllUserTokens } from './user-tokens.js';
import { changeOwnPassword, passwordHash, passwordLogin, sessionDigest } from './password-login.js';
import { inTransaction } from './pg-transaction.js';
import { appendSecurityEvent } from './security-audit.js';
import { PostgresAccessGroups } from './access-groups.js';
import { accountCapacity, capacityMutation, conflict, success } from './identity-mutation.js';
import type {
  AccessGroup,
  Account,
  AccountOrigin,
  CredentialRejection,
  CreatedUserToken,
  IdentityStore,
  LoginResult,
  SecurityActor,
  UserToken,
} from '@proanima/arkvory-application';

export class PostgresIdentity implements IdentityStore {
  private readonly userTokens: PostgresUserTokens;
  private readonly accessGroups: PostgresAccessGroups;
  constructor(private readonly pool: Pool) {
    this.userTokens = new PostgresUserTokens(pool);
    this.accessGroups = new PostgresAccessGroups(pool);
  }

  async createUser(
    name: string,
    password: string,
    administrator: boolean,
    origin: AccountOrigin,
    actor: SecurityActor,
  ): Promise<Account> {
    const salt = randomBytes(16).toString('hex');
    const hash = (await passwordHash(password, salt)).toString('hex');
    const id = randomUUID();
    try {
      await capacityMutation(this.pool, async (client) => {
        const inserted = await client.query(
          `INSERT INTO arkvory_users(id,name,password_salt,password_hash,administrator)
           SELECT $1,$2,$3,$4,$5 WHERE (SELECT count(*) FROM arkvory_users)<$6`,
          [id, name, salt, hash, administrator, accountCapacity[origin]],
        );
        if (!inserted.rowCount)
          throw new ArkvoryError('capacity_exceeded', 'Account limit reached', {
            reason: 'account_limit',
          });
        const action = origin === 'self-registration' ? 'auth.register' : 'user.create';
        await appendSecurityEvent(
          client,
          actor,
          success(action, `user:${id}`, { name, administrator }),
        );
      });
    } catch (error) {
      conflict(error);
    }
    return { id, name, administrator, enabled: true };
  }

  async updateUser(
    id: string,
    enabled: boolean | undefined,
    password: string | undefined,
    actor: SecurityActor,
  ): Promise<Account> {
    const salt = password === undefined ? null : randomBytes(16).toString('hex');
    const hash =
      password === undefined || salt === null
        ? null
        : (await passwordHash(password, salt)).toString('hex');
    return inTransaction(this.pool, async (client) => {
      const result = await client.query<Account>(
        `UPDATE arkvory_users SET enabled=COALESCE($2,enabled),
         password_salt=COALESCE($3,password_salt),password_hash=COALESCE($4,password_hash),
         failed_logins=CASE WHEN $4::text IS NULL THEN failed_logins ELSE 0 END,
         locked_until=CASE WHEN $4::text IS NULL THEN locked_until ELSE NULL END,
         login_debt=CASE WHEN $4::text IS NULL THEN login_debt ELSE 0 END
         WHERE id=$1 RETURNING id,name,administrator,enabled`,
        [id, enabled ?? null, salt, hash],
      );
      const user = result.rows[0];
      if (!user) throw new ArkvoryError('not_found', 'Account not found');
      if (enabled === false || password !== undefined)
        await client.query('DELETE FROM arkvory_user_sessions WHERE user_id=$1', [id]);
      if (enabled !== undefined)
        await appendSecurityEvent(
          client,
          actor,
          success(enabled ? 'user.enable' : 'user.disable', `user:${id}`),
        );
      if (password !== undefined) {
        // A reset password must also end automation that the old password holder created.
        const revokedTokens = await revokeAllUserTokens(client, id);
        await appendSecurityEvent(
          client,
          actor,
          success('user.password.reset', `user:${id}`, { revokedTokens }),
        );
      }
      return user;
    });
  }

  users(): Promise<readonly Account[]> {
    return readUsers(this.pool);
  }

  createGroup(name: string, actor: SecurityActor): Promise<AccessGroup> {
    return this.accessGroups.createGroup(name, actor);
  }
  groups(): Promise<readonly AccessGroup[]> {
    return this.accessGroups.groups();
  }
  membership(...args: Parameters<PostgresAccessGroups['membership']>) {
    return this.accessGroups.membership(...args);
  }
  grant(...args: Parameters<PostgresAccessGroups['grant']>) {
    return this.accessGroups.grant(...args);
  }

  login(name: string, password: string, actor: SecurityActor): Promise<LoginResult> {
    return passwordLogin(this.pool, name, password, actor);
  }

  async resolve(token: string): Promise<Principal | null> {
    if (/^dps_[A-Za-z0-9_-]{43}$/.test(token)) {
      const result = await this.pool.query<{ id: string }>(
        `SELECT u.id FROM arkvory_user_sessions s JOIN arkvory_users u ON u.id=s.user_id
         WHERE s.token_hash=$1 AND s.expires_at>now() AND u.enabled`,
        [sessionDigest(token)],
      );
      const user = result.rows[0];
      return user ? accountPrincipal(this.pool, user.id, 'session') : null;
    }
    if (/^pat_[A-Za-z0-9_-]{43}$/.test(token)) {
      const resolved = await this.userTokens.resolve(token);
      return resolved
        ? accountPrincipal(this.pool, resolved.userId, 'personal-token', resolved.scope)
        : null;
    }
    return null;
  }

  /**
   * Why `resolve` refused a well-formed credential. Same digest lookup as resolve, without the
   * expiry filter; disabled accounts and unknown digests both read as credential_invalid.
   */
  async rejection(token: string): Promise<CredentialRejection> {
    if (/^dps_[A-Za-z0-9_-]{43}$/.test(token)) {
      const result = await this.pool.query<{ expired: boolean }>(
        `SELECT s.expires_at<=now() AS expired FROM arkvory_user_sessions s
         JOIN arkvory_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND u.enabled`,
        [sessionDigest(token)],
      );
      return result.rows[0]?.expired ? 'session_expired' : 'credential_invalid';
    }
    if (/^pat_[A-Za-z0-9_-]{43}$/.test(token)) return this.userTokens.rejection(token);
    return 'credential_invalid';
  }

  async logout(token: string): Promise<void> {
    if (/^dps_[A-Za-z0-9_-]{43}$/.test(token))
      await this.pool.query('DELETE FROM arkvory_user_sessions WHERE token_hash=$1', [
        sessionDigest(token),
      ]);
  }

  changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    actor: SecurityActor,
  ): Promise<void> {
    return changeOwnPassword(this.pool, userId, currentPassword, newPassword, actor);
  }

  createToken(
    userId: string,
    name: string,
    request: { expiresAt: Date; scope: TokenScope },
    actor: SecurityActor,
  ): Promise<CreatedUserToken> {
    return this.userTokens.createToken(userId, name, request, actor);
  }

  tokens(userId: string): Promise<readonly UserToken[]> {
    return this.userTokens.tokens(userId);
  }

  revokeToken(userId: string, tokenId: string, actor: SecurityActor): Promise<void> {
    return this.userTokens.revokeToken(userId, tokenId, actor);
  }

  /** Background jobs act as account automation: repository grants only, never administration. */
  principalForUser(userId: string): Promise<Principal | null> {
    return accountPrincipal(this.pool, userId, 'personal-token', 'read-write');
  }
}

async function readUsers(pool: Pool): Promise<readonly Account[]> {
  const result = await pool.query<Account>(
    'SELECT id,name,administrator,enabled FROM arkvory_users ORDER BY lower(name),id LIMIT 1001',
  );
  if (result.rows.length > 1000)
    throw new ArkvoryError('invalid_input', 'User list exceeds 1000 accounts');
  return result.rows;
}

/**
 * Sessions carry the full account authority. Personal tokens never inherit the administrator
 * flag, and a `read` token drops every write grant before any policy sees the principal.
 */
async function accountPrincipal(
  pool: Pool,
  userId: string,
  credential: Extract<CredentialKind, 'session' | 'personal-token'>,
  scope?: TokenScope,
): Promise<Principal | null> {
  const result = await pool.query<{ id: string; administrator: boolean }>(
    'SELECT id,administrator FROM arkvory_users WHERE id=$1 AND enabled',
    [userId],
  );
  const user = result.rows[0];
  if (!user) return null;
  const rights = await pool.query<{ repository: string; access: 'read' | 'write' }>(
    `SELECT gg.repository,gg.access FROM arkvory_group_members gm
     JOIN arkvory_group_grants gg ON gg.group_id=gm.group_id WHERE gm.user_id=$1`,
    [user.id],
  );
  const writable = credential === 'session' || scope === 'read-write';
  const grants = new Map<string, Set<'read' | 'write'>>();
  for (const right of rights.rows) {
    const permissions = grants.get(right.repository) ?? new Set<'read' | 'write'>();
    permissions.add('read');
    if (right.access === 'write' && writable) permissions.add('write');
    grants.set(right.repository, permissions);
  }
  return {
    id: `user:${user.id}`,
    credential,
    ...(credential === 'personal-token' ? { tokenScope: scope ?? 'read' } : {}),
    repositories: [],
    permissions: [],
    grants: [...grants].map(([repository, permissions]) => ({
      repository,
      permissions: [...permissions],
    })),
    administrator: credential === 'session' && user.administrator,
  };
}
