import type { PoolClient } from 'pg';
import { ArkvoryError } from '@proanima/arkvory-domain';
import { appendCatalogAudit } from './catalog-audit.js';
import { lockCatalogMutation } from './catalog-mutation.js';

/**
 * Publishes or cancels one upload inside the caller's transaction, on the connection that holds
 * its upload lock. A publication enters the repository change feed (ADR 0058): the repository
 * gate is taken before the row, the lock order of every catalog change, so per repository the
 * journal sequence follows commit order. A repeated publish of an available upload succeeds
 * idempotently and journals nothing. Returns the updated row for the caller to decode.
 */
export async function transitionUpload(
  client: PoolClient,
  repository: string,
  id: string,
  target: 'available' | 'cancelled',
  requestId: string | null,
): Promise<Record<string, unknown>> {
  if (target === 'available') await lockCatalogMutation(client, repository);
  const updated = await client.query<Record<string, unknown>>(
    `WITH previous AS (SELECT status FROM arkvory_uploads WHERE repository=$1 AND id=$2 FOR UPDATE)
     UPDATE arkvory_uploads u SET status=$3, cancelled_at=CASE WHEN $3='cancelled' THEN COALESCE(u.cancelled_at,now()) ELSE u.cancelled_at END
     FROM previous
     WHERE u.repository=$1 AND u.id=$2 AND u.status IN ('pending',$3) AND (u.status='available' OR $3='cancelled' OR u.expires_at>now())
     RETURNING u.*, previous.status AS previous_status`,
    [repository, id, target],
  );
  const row = updated.rows[0];
  if (!row)
    throw new ArkvoryError('conflict', 'Upload state prevents this operation', {
      reason: 'upload_state',
    });
  if (target === 'available' && row['previous_status'] === 'pending')
    await appendCatalogAudit(
      client,
      [{ repository, artifactId: id, actor: String(row['owner']), action: 'artifact.publish' }],
      requestId,
    );
  return row;
}
