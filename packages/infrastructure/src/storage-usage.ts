import type { Pool, PoolClient } from 'pg';
import { ArkvoryError, capacityState } from '@proanima/arkvory-domain';
import type { StoragePolicy } from '@proanima/arkvory-domain';
import type { StorageEvent, StorageUsage } from '@proanima/arkvory-application';

/** Bytes of a repository by upload state; reserved counts everything not yet reclaimed. */
export async function repositoryUsage(
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
    COALESCE(sum(size) FILTER(WHERE NOT reclaimed),0)::text AS reserved FROM arkvory_uploads WHERE repository=$1`,
      [repository],
    )
  ).rows[0];
  if (!row) throw new ArkvoryError('unavailable', 'Storage usage unavailable');
  return {
    publishedBytes: row.published,
    pendingBytes: row.pending,
    retiredBytes: row.retired,
    reservedBytes: row.reserved,
    quotaBytes: policy.quotaBytes,
    state: capacityState(row.reserved, policy),
  };
}

/** One page (100) of a repository's storage events after `after`, oldest first. */
export async function storageEventPage(
  pool: Pool,
  repository: string,
  after: string,
  level?: StorageEvent['level'],
) {
  const rows = (
    await pool.query<{
      sequence: string;
      occurred_at: Date;
      level: StorageEvent['level'];
      code: string;
      details: StorageEvent['details'];
    }>(
      `SELECT * FROM arkvory_storage_events WHERE repository=$1 AND sequence>$2::bigint
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
