import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { ArkvoryError } from '@proanima/arkvory-domain';
import type { AccessGroup, SecurityActor } from '@proanima/arkvory-application';
import { inTransaction } from './pg-transaction.js';
import { appendSecurityEvent } from './security-audit.js';
import { capacityMutation, conflict, success } from './identity-mutation.js';

/** Access groups, their members and repository grants; every change is security-audited. */
export class PostgresAccessGroups {
  constructor(private readonly pool: Pool) {}

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
}
