import type { Pool, PoolClient } from 'pg';
import type { MutationAccess } from '@proanima/arkvory-domain';
import { lockCatalogMutation, requirePublished } from './catalog-mutation.js';
import { lockServiceAccess } from './service-authorization.js';
import { appendCatalogAudit } from './catalog-audit.js';
import { accessCorrelation } from './request-correlation.js';

/** Who changes which published artifact; `action` is the audit action recorded on success. */
export interface CatalogChange {
  repository: string;
  id: string;
  actor: string;
  action: string;
  access: MutationAccess | undefined;
}

/**
 * Runs one catalog metadata mutation of a published artifact in a single short transaction.
 * Lock order is fixed and shared with retirement/policy changes: managed key access (FOR SHARE),
 * then the repository catalog advisory lock, then the published state check. The audit row is
 * written in the same transaction, so a change is never committed without its audit entry.
 * A failed ROLLBACK discards the connection so a half-open transaction never returns to the pool.
 */
export async function changePublished<T>(
  pool: Pool,
  change: CatalogChange,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let broken = false;
  try {
    await client.query('BEGIN');
    await lockServiceAccess(client, change.access);
    await lockCatalogMutation(client, change.repository);
    await requirePublished(client, change.repository, change.id);
    const result = await work(client);
    await appendCatalogAudit(
      client,
      [
        {
          repository: change.repository,
          artifactId: change.id,
          actor: change.actor,
          action: change.action,
        },
      ],
      accessCorrelation(change.access),
    );
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
