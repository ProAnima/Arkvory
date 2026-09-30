import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { ArkvoryError } from '@proanima/arkvory-domain';
import type { Principal } from '@proanima/arkvory-domain';
import { PostgresUserTokens } from './user-tokens.js';
import type {
  AccessGroup,
  Account,
  CreatedUserToken,
  IdentityStore,
  LoginResult,
  UserToken,
} from '@proanima/arkvory-application';

const dummySalt = '0'.repeat(32);
function digest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
function passwordHash(password: string, salt: string): Promise<Buffer> {
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
function conflict(error: unknown): never {
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505')
    throw new ArkvoryError('conflict', 'Account or group already exists');
  throw error;
}

interface UserRow {
  id: string;
  name: string;
  administrator: boolean;
  password_salt: string;
  password_hash: string;
  enabled: boolean;
  locked: boolean;
}

// arkvory-exception ARCH-006 -- Existing adapter or contract implementation combines related operations; freeze growth and extract cohesive responsibilities while preserving transactional and authorization invariants.
export class PostgresIdentity implements IdentityStore {
  private readonly userTokens: PostgresUserTokens;
  constructor(private readonly pool: Pool) {
    this.userTokens = new PostgresUserTokens(pool);
  }

  async createUser(name: string, password: string, administrator: boolean): Promise<Account> {
    const salt = randomBytes(16).toString('hex');
    const hash = (await passwordHash(password, salt)).toString('hex');
    const id = randomUUID();
    try {
      const inserted = await capacityMutation(this.pool, (client) =>
        client.query(
          `INSERT INTO arkvory_users(id,name,password_salt,password_hash,administrator)
         SELECT $1,$2,$3,$4,$5 WHERE (SELECT count(*) FROM arkvory_users)<1000`,
          [id, name, salt, hash, administrator],
        ),
      );
      if (!inserted.rowCount) throw new ArkvoryError('capacity_exceeded', 'Account limit reached');
    } catch (error) {
      conflict(error);
    }
    return { id, name, administrator, enabled: true };
  }

  async updateUser(
    id: string,
    enabled: boolean | undefined,
    password: string | undefined,
  ): Promise<Account> {
    const salt = password === undefined ? null : randomBytes(16).toString('hex');
    const hash =
      password === undefined || salt === null
        ? null
        : (await passwordHash(password, salt)).toString('hex');
    const client = await this.pool.connect();
    let broken = false;
    try {
      await client.query('BEGIN');
      const result = await client.query<Account>(
        `UPDATE arkvory_users SET enabled=COALESCE($2,enabled),
         password_salt=COALESCE($3,password_salt),password_hash=COALESCE($4,password_hash),
         failed_logins=CASE WHEN $4::text IS NULL THEN failed_logins ELSE 0 END,
         locked_until=CASE WHEN $4::text IS NULL THEN locked_until ELSE NULL END
         WHERE id=$1 RETURNING id,name,administrator,enabled`,
        [id, enabled ?? null, salt, hash],
      );
      const user = result.rows[0];
      if (!user) throw new ArkvoryError('not_found', 'Account not found');
      if (enabled === false || password !== undefined)
        await client.query('DELETE FROM arkvory_user_sessions WHERE user_id=$1', [id]);
      await client.query('COMMIT');
      return user;
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

  users(): Promise<readonly Account[]> {
    return readUsers(this.pool);
  }

  async createGroup(name: string): Promise<AccessGroup> {
    const id = randomUUID();
    try {
      const inserted = await capacityMutation(this.pool, (client) =>
        client.query(
          `INSERT INTO arkvory_access_groups(id,name)
         SELECT $1,$2 WHERE (SELECT count(*) FROM arkvory_access_groups)<100`,
          [id, name],
        ),
      );
      if (!inserted.rowCount) throw new ArkvoryError('capacity_exceeded', 'Group limit reached');
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
      throw new ArkvoryError('capacity_exceeded', 'Access group listing limit reached');
    return groups.rows.map((group) => ({
      ...group,
      members: members.rows.filter((row) => row.group_id === group.id).map((row) => row.user_id),
      grants: grants.rows
        .filter((row) => row.group_id === group.id)
        .map((row) => ({ repository: row.repository, access: row.access })),
    }));
  }

  async membership(groupId: string, userId: string, present: boolean): Promise<void> {
    if (present) {
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
            throw new ArkvoryError('capacity_exceeded', 'Membership limit reached');
          }
        }
      });
    } else {
      await this.pool.query('DELETE FROM arkvory_group_members WHERE group_id=$1 AND user_id=$2', [
        groupId,
        userId,
      ]);
    }
  }

  async grant(groupId: string, repository: string, access: 'read' | 'write' | null): Promise<void> {
    if (access === null) {
      await this.pool.query(
        'DELETE FROM arkvory_group_grants WHERE group_id=$1 AND repository=$2',
        [groupId, repository],
      );
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
        throw new ArkvoryError('capacity_exceeded', 'Grant limit reached');
      }
    });
  }

  async login(name: string, password: string): Promise<LoginResult> {
    const client = await this.pool.connect();
    let broken = false;
    try {
      await client.query('BEGIN');
      const result = await client.query<UserRow>(
        `SELECT id,name,administrator,password_salt,password_hash,enabled,
                locked_until IS NOT NULL AND locked_until>now() AS locked
         FROM arkvory_users WHERE lower(name)=lower($1) FOR UPDATE`,
        [name],
      );
      const user = result.rows[0];
      const candidate = await passwordHash(password, user?.password_salt ?? dummySalt);
      const stored = user ? Buffer.from(user.password_hash, 'hex') : Buffer.alloc(64);
      const matched = stored.length === candidate.length && timingSafeEqual(candidate, stored);
      const valid = user && !user.locked && user.enabled && matched;
      if (!valid) {
        if (user && !user.locked) {
          await client.query(
            `UPDATE arkvory_users SET failed_logins=failed_logins+1,
             locked_until=CASE WHEN failed_logins+1>=5 THEN now()+interval '15 minutes' ELSE NULL END
             WHERE id=$1`,
            [user.id],
          );
        }
        await client.query('COMMIT');
        throw new ArkvoryError('unauthorized', 'Invalid credentials');
      }
      await client.query('UPDATE arkvory_users SET failed_logins=0,locked_until=NULL WHERE id=$1', [
        user.id,
      ]);
      await client.query(
        `DELETE FROM arkvory_user_sessions WHERE user_id=$1 AND
         (expires_at<=now() OR token_hash IN (
           SELECT token_hash FROM arkvory_user_sessions WHERE user_id=$1 AND expires_at>now()
           ORDER BY created_at DESC,token_hash DESC OFFSET 31
         ))`,
        [user.id],
      );
      const token = 'dps_' + randomBytes(32).toString('base64url');
      const session = await client.query<{ expires_at: Date }>(
        `INSERT INTO arkvory_user_sessions(token_hash,user_id,expires_at)
         VALUES($1,$2,now()+interval '12 hours') RETURNING expires_at`,
        [digest(token), user.id],
      );
      await client.query('COMMIT');
      const expiresAt = session.rows[0]?.expires_at;
      if (!expiresAt) throw new ArkvoryError('unavailable', 'Session creation failed');
      return {
        token,
        expiresAt: expiresAt.toISOString(),
        account: { id: user.id, name: user.name, administrator: user.administrator, enabled: true },
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

  async resolve(token: string): Promise<Principal | null> {
    if (/^dps_[A-Za-z0-9_-]{43}$/.test(token)) {
      const result = await this.pool.query<{ id: string; administrator: boolean }>(
        `SELECT u.id,u.administrator FROM arkvory_user_sessions s JOIN arkvory_users u ON u.id=s.user_id
         WHERE s.token_hash=$1 AND s.expires_at>now() AND u.enabled`,
        [digest(token)],
      );
      const user = result.rows[0];
      if (!user) return null;
      return principalForUser(this.pool, user.id);
    }
    if (/^pat_[A-Za-z0-9_-]{43}$/.test(token)) {
      const userId = await this.userTokens.resolve(token);
      return userId ? principalForUser(this.pool, userId) : null;
    }
    return null;
  }

  async logout(token: string): Promise<void> {
    if (/^dps_[A-Za-z0-9_-]{43}$/.test(token))
      await this.pool.query('DELETE FROM arkvory_user_sessions WHERE token_hash=$1', [
        digest(token),
      ]);
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const client = await this.pool.connect();
    let broken = false;
    try {
      await client.query('BEGIN');
      const result = await client.query<
        Pick<UserRow, 'password_salt' | 'password_hash' | 'enabled'>
      >('SELECT password_salt,password_hash,enabled FROM arkvory_users WHERE id=$1 FOR UPDATE', [
        userId,
      ]);
      const user = result.rows[0];
      const candidate = await passwordHash(currentPassword, user?.password_salt ?? dummySalt);
      const stored = user ? Buffer.from(user.password_hash, 'hex') : Buffer.alloc(64);
      if (
        !user?.enabled ||
        stored.length !== candidate.length ||
        !timingSafeEqual(candidate, stored)
      )
        throw new ArkvoryError('unauthorized', 'Invalid credentials');
      const salt = randomBytes(16).toString('hex');
      const hash = (await passwordHash(newPassword, salt)).toString('hex');
      await client.query(
        'UPDATE arkvory_users SET password_salt=$2,password_hash=$3,failed_logins=0,locked_until=NULL WHERE id=$1',
        [userId, salt, hash],
      );
      await client.query('DELETE FROM arkvory_user_sessions WHERE user_id=$1', [userId]);
      await client.query('COMMIT');
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

  createToken(userId: string, name: string, expiresAt?: string): Promise<CreatedUserToken> {
    return this.userTokens.createToken(userId, name, expiresAt);
  }

  tokens(userId: string): Promise<readonly UserToken[]> {
    return this.userTokens.tokens(userId);
  }

  revokeToken(userId: string, tokenId: string): Promise<void> {
    return this.userTokens.revokeToken(userId, tokenId);
  }

  principalForUser(userId: string): Promise<Principal | null> {
    return principalForUser(this.pool, userId);
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

async function principalForUser(pool: Pool, userId: string): Promise<Principal | null> {
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
  const grants = new Map<string, Set<'read' | 'write'>>();
  for (const right of rights.rows) {
    const permissions = grants.get(right.repository) ?? new Set<'read' | 'write'>();
    permissions.add('read');
    if (right.access === 'write') permissions.add('write');
    grants.set(right.repository, permissions);
  }
  return {
    id: `user:${user.id}`,
    repositories: [],
    permissions: [],
    grants: [...grants].map(([repository, permissions]) => ({
      repository,
      permissions: [...permissions],
    })),
    administrator: user.administrator,
  };
}

async function capacityMutation<T>(
  pool: Pool,
  action: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let broken = false;
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(18471,10)');
    const result = await action(client);
    await client.query('COMMIT');
    return result;
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
