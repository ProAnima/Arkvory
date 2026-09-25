import type { Pool, PoolClient } from 'pg';
import {
  DepotError,
  defaultStoragePolicy,
  parseStoragePolicy,
  capacityState,
} from '@proanima/depot-domain';
import type { MutationAccess, StoragePolicy } from '@proanima/depot-domain';
import type {
  StoragePolicyStore,
  StoragePolicySnapshot,
  StorageUsage,
  StorageEvent,
  DeletionResult,
} from '@proanima/depot-application';
import { lockCatalogMutation } from './catalog-mutation.js';
import { lockServiceAccess } from './service-authorization.js';
import { candidateSql, candidate, removeArtifactInTransaction } from './retention.js';
import type { CandidateRow } from './retention.js';

interface PolicyRow {
  revision: number;
  policy: unknown;
  authorizer_key_id: string;
  next_run_at: Date;
  last_run_at: Date | null;
  last_deleted: number;
  last_error: string | null;
  capacity_state: string | null;
}
function snapshot(row?: PolicyRow): StoragePolicySnapshot {
  const policy = row ? parseStoragePolicy(row.policy) : defaultStoragePolicy();
  return {
    revision: row?.revision ?? 0,
    policy,
    nextRunAt: policy.enabled ? (row?.next_run_at.toISOString() ?? null) : null,
    lastRunAt: row?.last_run_at?.toISOString() ?? null,
    lastDeleted: row?.last_deleted ?? 0,
    lastError: row?.last_error ?? null,
  };
}
// Ranking is by publication time, not semantic version. A build belonging to several
// identities/channels survives if ANY bucket needs it. Unknown labels share the default bucket.
const rankedSql =
  `WITH identities AS (
  SELECT DISTINCT u.id,u.published_at,
    CASE WHEN $2::jsonb->>'grouping'='repository' THEN '' ELSE lower(p.package_group)||'/'||lower(p.name) END AS identity,
    COALESCE(a.labels,u.descriptor->'labels','[]'::jsonb) AS labels
  FROM depot_packages p JOIN depot_uploads u ON u.id=p.artifact_id AND u.repository=p.repository
  LEFT JOIN depot_annotations a ON a.artifact_id=u.id
  WHERE u.repository=$1 AND u.status='available'
), buckets AS (
  SELECT i.id,i.published_at,i.identity,COALESCE(c.label,'') AS channel,
    COALESCE(c.keep,($2::jsonb->>'keepLast')::integer) AS keep
  FROM identities i LEFT JOIN LATERAL (
    SELECT entry->>'label' AS label,(entry->>'keepLast')::integer AS keep
    FROM jsonb_array_elements($2::jsonb->'channels') entry
    WHERE $2::jsonb->>'grouping'='package-channel' AND i.labels ? (entry->>'label')
  ) c ON true
), ranks AS (
  SELECT id,keep,row_number() OVER(PARTITION BY identity,channel ORDER BY published_at DESC,id DESC) AS rank FROM buckets
), eligible AS (
  SELECT id FROM ranks GROUP BY id HAVING NOT bool_or(rank<=keep)
)
SELECT * FROM (` +
  candidateSql +
  ` AND u.id IN(SELECT id FROM eligible) AND u.published_at<$4::timestamptz) q
WHERE NOT referenced AND NOT asset AND NOT attached AND NOT labelled
ORDER BY published_at,id LIMIT 101`;

export class PostgresStoragePolicy implements StoragePolicyStore {
  constructor(private readonly pool: Pool) {}
  private async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    let broken = false;
    try {
      await c.query('BEGIN');
      const result = await fn(c);
      await c.query('COMMIT');
      return result;
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
  }
  private async row(c: Pool | PoolClient, repository: string) {
    return (
      await c.query<PolicyRow>('SELECT * FROM depot_storage_policies WHERE repository=$1', [
        repository,
      ])
    ).rows[0];
  }
  async get(repository: string) {
    return snapshot(await this.row(this.pool, repository));
  }
  async save(access: MutationAccess, revision: number, policy: StoragePolicy) {
    const key = access.principal.managed?.keyId;
    if (!key) throw new DepotError('forbidden', 'Managed storage permission required');
    return this.transaction(async (c) => {
      // Same order as upload reservations: quota changes cannot race create().
      await c.query('SELECT pg_advisory_xact_lock(18471,2)');
      await lockServiceAccess(c, access);
      await lockCatalogMutation(c, access.repository);
      const current = await this.row(c, access.repository);
      if ((current?.revision ?? 0) !== revision || revision === 2147483647)
        throw new DepotError('conflict', 'Storage policy revision changed');
      const result = await c.query<PolicyRow>(
        `INSERT INTO depot_storage_policies(repository,revision,policy,authorizer_key_id)
        VALUES($1,1,$2,$3) ON CONFLICT(repository) DO UPDATE SET revision=depot_storage_policies.revision+1,
        policy=EXCLUDED.policy,authorizer_key_id=EXCLUDED.authorizer_key_id,next_run_at=now(),last_error=NULL
        RETURNING *`,
        [access.repository, JSON.stringify(policy), key],
      );
      await this.record(c, access.repository, 'info', 'storage.policy_updated', {
        revision: revision + 1,
        actor: access.principal.id,
        enabled: policy.enabled ? 1 : 0,
      });
      return snapshot(result.rows[0]);
    });
  }
  private async usageIn(
    c: Pool | PoolClient,
    repository: string,
    policy: StoragePolicy,
  ): Promise<StorageUsage> {
    const row = (
      await c.query<{ published: string; pending: string; retired: string; reserved: string }>(
        `SELECT
      COALESCE(sum(size) FILTER(WHERE status='available' AND NOT reclaimed),0)::text AS published,
      COALESCE(sum(size) FILTER(WHERE status='pending' AND NOT reclaimed),0)::text AS pending,
      COALESCE(sum(size) FILTER(WHERE status='cancelled' AND NOT reclaimed),0)::text AS retired,
      COALESCE(sum(size) FILTER(WHERE NOT reclaimed),0)::text AS reserved FROM depot_uploads WHERE repository=$1`,
        [repository],
      )
    ).rows[0];
    if (!row) throw new DepotError('unavailable', 'Storage usage unavailable');
    return {
      publishedBytes: row.published,
      pendingBytes: row.pending,
      retiredBytes: row.retired,
      reservedBytes: row.reserved,
      quotaBytes: policy.quotaBytes,
      state: capacityState(row.reserved, policy),
    };
  }
  async usage(repository: string) {
    return this.usageIn(this.pool, repository, (await this.get(repository)).policy);
  }
  private async candidates(c: Pool | PoolClient, repository: string, policy: StoragePolicy) {
    const clock = (
      await c.query<{ cutoff: Date }>(
        "SELECT clock_timestamp()-($1::integer * interval '1 hour') AS cutoff",
        [policy.minAgeHours],
      )
    ).rows[0];
    if (!clock) throw new DepotError('unavailable', 'Storage clock unavailable');
    const rows = (
      await c.query<CandidateRow>(rankedSql, [
        repository,
        JSON.stringify(policy),
        policy.protectedLabels,
        clock.cutoff.toISOString(),
      ])
    ).rows;
    return {
      items: rows.slice(0, 100).map(candidate),
      hasMore: rows.length > 100,
      cutoff: clock.cutoff.toISOString(),
    };
  }
  async preview(repository: string) {
    return this.transaction(async (c) => {
      await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const current = snapshot(await this.row(c, repository));
      const result = await this.candidates(c, repository, current.policy);
      return { revision: current.revision, items: result.items, hasMore: result.hasMore };
    });
  }
  async run(access: MutationAccess, revision: number, automatic = false) {
    return this.transaction(async (c) => {
      await lockServiceAccess(c, access);
      await lockCatalogMutation(c, access.repository);
      const row = await this.row(c, access.repository),
        current = snapshot(row);
      if (!row || current.revision !== revision || !current.policy.enabled)
        throw new DepotError('conflict', 'Enabled storage policy revision required');
      if (automatic) {
        if (row.authorizer_key_id !== access.principal.managed?.keyId)
          throw new DepotError('conflict', 'Policy authorizer changed');
        const due = (
          await c.query<{ due: boolean }>('SELECT $1::timestamptz<=clock_timestamp() AS due', [
            row.next_run_at,
          ])
        ).rows[0]?.due;
        if (!due) return { items: [] };
      }
      const chosen = await this.candidates(c, access.repository, current.policy);
      const items: DeletionResult[] = [];
      for (const item of chosen.items)
        items.push(
          await removeArtifactInTransaction(
            c,
            access,
            { id: item.id, expectedAnnotationRevision: item.annotationRevision },
            { publishedBefore: chosen.cutoff, protectedLabels: current.policy.protectedLabels },
          ),
        );
      const deleted = items.filter((i) => i.outcome === 'deleted').length;
      await c.query(
        `UPDATE depot_storage_policies SET last_run_at=clock_timestamp(),last_deleted=$2,last_error=NULL,
        next_run_at=clock_timestamp()+($3::integer * interval '1 minute') WHERE repository=$1`,
        [access.repository, deleted, chosen.hasMore ? 1 : current.policy.intervalMinutes],
      );
      if (deleted)
        await this.record(c, access.repository, 'info', 'retention.completed', {
          deleted,
          revision,
          actor: access.principal.id,
        });
      await this.checkCapacity(c, access.repository, current.policy, row.capacity_state);
      return { items };
    });
  }
  async due() {
    return (
      await this.pool.query<{
        repository: string;
        revision: number;
        authorizer_key_id: string;
        enabled: boolean;
      }>(`SELECT repository,revision,authorizer_key_id,(policy->>'enabled')::boolean AS enabled
      FROM depot_storage_policies WHERE (policy->>'enabled')::boolean AND next_run_at<=clock_timestamp() ORDER BY next_run_at,repository LIMIT 20`)
    ).rows;
  }
  async monitorCapacities(active: () => boolean) {
    const due = (
      await this.pool.query<{ repository: string }>(
        "SELECT repository FROM depot_storage_policies WHERE capacity_checked_at<clock_timestamp()-interval '1 minute' ORDER BY capacity_checked_at,repository LIMIT 20",
      )
    ).rows;
    for (const { repository } of due) {
      if (!active()) return;
      await this.transaction(async (c) => {
        await lockCatalogMutation(c, repository);
        const row = await this.row(c, repository);
        if (!row) return;
        await this.checkCapacity(c, repository, parseStoragePolicy(row.policy), row.capacity_state);
        await c.query(
          'UPDATE depot_storage_policies SET capacity_checked_at=clock_timestamp() WHERE repository=$1',
          [repository],
        );
      });
    }
  }
  async monitor(repository: string, revision: number, error?: string) {
    await this.transaction(async (c) => {
      await lockCatalogMutation(c, repository);
      const row = await this.row(c, repository);
      if (!row || row.revision !== revision) return;
      const policy = parseStoragePolicy(row.policy);
      await this.checkCapacity(c, repository, policy, row.capacity_state);
      if (error && row.last_error !== error)
        await this.record(c, repository, 'error', 'retention.failed', { reason: error, revision });
      await c.query(
        `UPDATE depot_storage_policies SET last_error=$2,next_run_at=clock_timestamp()+interval '1 minute' WHERE repository=$1`,
        [repository, error ?? null],
      );
    });
  }
  private async checkCapacity(
    c: PoolClient,
    repository: string,
    policy: StoragePolicy,
    previous: string | null,
  ) {
    const usage = await this.usageIn(c, repository, policy);
    if (previous !== usage.state) {
      await this.record(
        c,
        repository,
        usage.state === 'exceeded' || usage.state === 'critical'
          ? 'error'
          : usage.state === 'warning'
            ? 'warning'
            : 'info',
        'capacity.' + usage.state,
        {
          reservedBytes: usage.reservedBytes,
          retiredBytes: usage.retiredBytes,
          quotaBytes: usage.quotaBytes ?? 'unlimited',
        },
      );
      await c.query('UPDATE depot_storage_policies SET capacity_state=$2 WHERE repository=$1', [
        repository,
        usage.state,
      ]);
    }
  }
  // Diagnostic history is bounded; immutable per-artifact deletion audit remains separate.
  private async record(
    c: PoolClient,
    repository: string,
    level: StorageEvent['level'],
    code: string,
    details: StorageEvent['details'],
  ) {
    await c.query('SELECT pg_advisory_xact_lock(18471,15)');
    await c.query(
      'INSERT INTO depot_storage_events(repository,level,code,details) VALUES($1,$2,$3,$4)',
      [repository, level, code, JSON.stringify(details)],
    );
    await c.query(
      `DELETE FROM depot_storage_events WHERE repository=$1 AND sequence <=
      (SELECT sequence FROM depot_storage_events WHERE repository=$1 ORDER BY sequence DESC OFFSET 1000 LIMIT 1)`,
      [repository],
    );
    await c.query(`DELETE FROM depot_storage_events WHERE sequence <=
      (SELECT sequence FROM depot_storage_events ORDER BY sequence DESC OFFSET 20000 LIMIT 1)`);
  }
  async recordEvent(
    repository: string,
    level: StorageEvent['level'],
    code: string,
    details: StorageEvent['details'],
  ) {
    await this.transaction((c) => this.record(c, repository, level, code, details));
  }
  async events(repository: string, after: string, level?: StorageEvent['level']) {
    const rows = (
      await this.pool.query<{
        sequence: string;
        occurred_at: Date;
        level: StorageEvent['level'];
        code: string;
        details: StorageEvent['details'];
      }>(
        `SELECT * FROM depot_storage_events WHERE repository=$1 AND sequence>$2::bigint
      AND ($3::text IS NULL OR level=$3) ORDER BY sequence LIMIT 101`,
        [repository, after, level ?? null],
      )
    ).rows;
    const items = rows.slice(0, 100).map((r) => ({
      sequence: r.sequence,
      occurredAt: r.occurred_at.toISOString(),
      level: r.level,
      code: r.code,
      details: r.details,
    }));
    return { items, next: rows.length > 100 ? (items.at(-1)?.sequence ?? null) : null };
  }
}
