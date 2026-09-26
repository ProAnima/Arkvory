import type { Pool, PoolClient } from 'pg';
import { defaultCleanupPolicy, parseCleanupPolicy, ArkvoryError } from '@proanima/arkvory-domain';
import type { CleanupPolicy, MutationAccess } from '@proanima/arkvory-domain';
import type { CleanupSettings, CleanupSnapshot } from '@proanima/arkvory-application';
import { lockServiceAccess } from './service-authorization.js';
import { lockCatalogMutation } from './catalog-mutation.js';
import { recordStorageEvent } from './storage-events.js';

interface Row {
  revision: number;
  policy: unknown;
  last_run_at: Date | null;
  next_run_at: Date;
  last_collected: number;
  last_deferred: number;
  last_failed: number;
  last_reclaimed_bytes: string;
  last_error: string | null;
}
export class PostgresCleanupSettings implements CleanupSettings {
  constructor(private readonly pool: Pool) {}
  async get(repository: string): Promise<CleanupSnapshot> {
    const row = (
      await this.pool.query<Row>('SELECT * FROM arkvory_cleanup_settings WHERE repository=$1', [
        repository,
      ])
    ).rows[0];
    const policy = row ? parseCleanupPolicy(row.policy) : { ...defaultCleanupPolicy };
    return {
      revision: row?.revision ?? 0,
      policy,
      lastRunAt: row?.last_run_at?.toISOString() ?? null,
      nextRunAt: policy.enabled ? (row?.next_run_at.toISOString() ?? null) : null,
      lastCollected: row?.last_collected ?? 0,
      lastDeferred: row?.last_deferred ?? 0,
      lastFailed: row?.last_failed ?? 0,
      lastReclaimedBytes: row?.last_reclaimed_bytes ?? '0',
      lastError: row?.last_error ?? null,
    };
  }
  private async mutate(
    access: MutationAccess,
    revision: number,
    action: (client: PoolClient) => Promise<void>,
  ) {
    const c = await this.pool.connect();
    let broken = false;
    try {
      await c.query('BEGIN');
      await lockServiceAccess(c, access);
      await lockCatalogMutation(c, access.repository);
      const row = (
        await c.query<{ revision: number }>(
          'SELECT revision FROM arkvory_cleanup_settings WHERE repository=$1 FOR UPDATE',
          [access.repository],
        )
      ).rows[0];
      if ((row?.revision ?? 0) !== revision || revision === 2147483647)
        throw new ArkvoryError('conflict', 'Cleanup configuration changed');
      await action(c);
      await c.query('COMMIT');
    } catch (error) {
      try {
        await c.query('ROLLBACK');
      } catch {
        broken = true;
      }
      throw error;
    } finally {
      c.release(broken);
    }
    return this.get(access.repository);
  }
  save(access: MutationAccess, revision: number, policy: CleanupPolicy) {
    return this.mutate(access, revision, async (c) => {
      await c.query(
        `INSERT INTO arkvory_cleanup_settings(repository,revision,policy) VALUES($1,1,$2)
        ON CONFLICT(repository) DO UPDATE SET revision=arkvory_cleanup_settings.revision+1,policy=$2,next_run_at=now()`,
        [access.repository, policy],
      );
      await recordStorageEvent(c, access.repository, 'info', 'cleanup.configured', {
        actor: access.principal.id,
        revision: revision + 1,
        enabled: policy.enabled ? 1 : 0,
      });
    });
  }
  request(access: MutationAccess, revision: number) {
    return this.mutate(access, revision, async (c) => {
      const updated = await c.query(
        `UPDATE arkvory_cleanup_settings SET next_run_at=now() WHERE repository=$1 AND policy->>'enabled'='true'`,
        [access.repository],
      );
      if (!updated.rowCount)
        throw new ArkvoryError('conflict', 'Enable cleanup before requesting a batch');
    });
  }
}
