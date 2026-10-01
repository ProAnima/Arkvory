import { randomBytes, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { ArkvoryError } from '@proanima/arkvory-domain';
import type { CredentialKind, Principal, TokenScope } from '@proanima/arkvory-domain';
import { PostgresUserTokens, revokeAllUserTokens } from './user-tokens.js';
import { changeOwnPassword, passwordHash, passwordLogin, sessionDigest } from './password-login.js';
import { inTransaction } from './pg-transaction.js';
import { appendSecurityEvent } from './security-audit.js';
import type {
  AccessGroup,
  Account,
  AccountOrigin,
  CredentialRejection,
  CreatedUserToken,
  IdentityStore,
  LoginResult,
  SecurityActor,
  SecurityEvent,
  UserToken,
} from '@proanima/arkvory-application';

function conflict(error: unknown): never {
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505')
    throw new ArkvoryError('conflict', 'Account or group already exists', {
      reason: 'already_exists',
    });
  throw error;
}
// Self-registration stops early so anonymous sign-ups cannot exhaust administrator capacity.
const accountCapacity: Record<AccountOrigin, number> = {
  administrator: 1000,
  'self-registration': 900,
};
const success = (
  action: SecurityEvent['action'],
  target: string,
  details?: SecurityEvent['details'],
): SecurityEvent => ({ action, target, outcome: 'success', ...(details ? { details } : {}) });

export class PostgresIdentity implements IdentityStore {
  private readonly userTokens: PostgresUserTokens;
  constructor(private readonly pool: Pool) {
    this.userTokens = new PostgresUserTokens(pool);
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

  async createGroup(name: string, actor: SecurityActor): Promise<AccessGroup> {
    const id = randomUUID();
    try {
      await capacityMutation(this.pool, async (client) => {
        const inserted = await client.query(
          `INSERT INTO arkvory_access_groups(id,name)
           SELECT $1,$2 WHERE (SELECT count(*) FROM arkvory_access_groups)<100`,
          [id, name],
        );
        if (!inserted.rowCount)
          throw new ArkvoryError('capacity_exceeded', 'Group limit reached', {
            reason: 'group_limit',
          });
        await appendSecurityEvent(client, actor, success('group.create', `group:${id}`, { name }));
      });
    } catch (error) {
      conflict(error);
    }
    return { id, name, members: [], grants: [] };
  }

  async groups(): Promise<readonly AccessGroup[]> {
    const groups = await this.pool.query<{ id: string; name: string }>(
      'SELECT id,name FROM arkvory_access_groups ORDER BY lower(name),id LIMIT 101',
    );
    if (groups.rows.length > 100)
      throw new ArkvoryError('invalid_input', 'Group list exceeds 100 groups');
    const [members, grants] = await Promise.all([
      this.pool.query<{ group_id: string; user_id: string }>(
        'SELECT group_id,user_id FROM arkvory_group_members ORDER BY group_id,user_id LIMIT 10001',
      ),
      this.pool.query<{ group_id: string; repository: string; access: 'read' | 'write' }>(
        'SELECT group_id,repository,access FROM arkvory_group_grants ORDER BY group_id,repository LIMIT 10001',
      ),
    ]);
    if (members.rows.length > 10000 || grants.rows.length > 10000)
      throw new ArkvoryError('capacity_exceeded', 'Access group listing limit reached', {
        reason: 'group_limit',
      });
    return groups.rows.map((group) => ({
      ...group,
      members: members.rows.filter((row) => row.group_id === group.id).map((row) => row.user_id),
      grants: grants.rows
        .filter((row) => row.group_id === group.id)
        .map((row) => ({ repository: row.repository, access: row.access })),
    }));
  }

  async membership(
    groupId: string,
    userId: string,
    present: boolean,
    actor: SecurityActor,
  ): Promise<void> {
    const event = success(
      present ? 'group.member.add' : 'group.member.remove',
      `group:${groupId}`,
      {
        userId,
      },
    );
    if (!present) {
      await inTransaction(this.pool, async (client) => {
        await client.query('DELETE FROM arkvory_group_members WHERE group_id=$1 AND user_id=$2', [
          groupId,
          userId,
        ]);
        await appendSecurityEvent(client, actor, event);
      });
      return;
    }
    await capacityMutation(this.pool, async (client) => {
      const result = await client.query(
        `INSERT INTO arkvory_group_members(group_id,user_id)
         SELECT g.id,u.id FROM arkvory_access_groups g CROSS JOIN arkvory_users u
         WHERE g.id=$1 AND u.id=$2 AND (SELECT count(*) FROM arkvory_group_members)<10000
         ON CONFLICT DO NOTHING`,
        [groupId, userId],
      );
      if (result.rowCount === 0) {
        const existing = await client.query(
          'SELECT 1 FROM arkvory_group_members WHERE group_id=$1 AND user_id=$2',
          [groupId, userId],
        );
        if (!existing.rowCount) {
          const valid = await client.query(
            'SELECT 1 FROM arkvory_access_groups g CROSS JOIN arkvory_users u WHERE g.id=$1 AND u.id=$2',
            [groupId, userId],
          );
          if (!valid.rowCount) throw new ArkvoryError('not_found', 'User or group not found');
          throw new ArkvoryError('capacity_exceeded', 'Membership limit reached', {
            reason: 'membership_limit',
          });
        }
      }
      await appendSecurityEvent(client, actor, event);
    });
  }

  async grant(
    groupId: string,
    repository: string,
    access: 'read' | 'write' | null,
    actor: SecurityActor,
  ): Promise<void> {
    if (access === null) {
      await inTransaction(this.pool, async (client) => {
        await client.query('DELETE FROM arkvory_group_grants WHERE group_id=$1 AND repository=$2', [
          groupId,
          repository,
        ]);
        await appendSecurityEvent(
          client,
          actor,
          success('group.grant.remove', `group:${groupId}`, { repository }),
        );
      });
      return;
    }
    await capacityMutation(this.pool, async (client) => {
      const result = await client.query(
        `INSERT INTO arkvory_group_grants(group_id,repository,access)
         SELECT id,$2::text,$3 FROM arkvory_access_groups WHERE id=$1 AND
         ((SELECT count(*) FROM arkvory_group_grants)<10000 OR
          EXISTS(SELECT 1 FROM arkvory_group_grants WHERE group_id=$1 AND repository=$2::text))
         ON CONFLICT(group_id,repository) DO UPDATE SET access=EXCLUDED.access`,
        [groupId, repository, access],
      );
      if (!result.rowCount) {
        const valid = await client.query('SELECT 1 FROM arkvory_access_groups WHERE id=$1', [
          groupId,
        ]);
        if (!valid.rowCount) throw new ArkvoryError('not_found', 'Group not found');
        throw new ArkvoryError('capacity_exceeded', 'Grant limit reached', {
          reason: 'grant_limit',
        });
      }
      await appendSecurityEvent(
        client,
        actor,
        success('group.grant.set', `group:${groupId}`, { repository, access }),
      );
    });
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

function capacityMutation<T>(pool: Pool, action: (client: PoolClient) => Promise<T>): Promise<T> {
  return inTransaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(18471,10)');
    return action(client);
  });
}
