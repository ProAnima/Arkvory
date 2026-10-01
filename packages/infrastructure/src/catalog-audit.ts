import type { Pool, PoolClient } from 'pg';
import type { CatalogAuditEntry } from '@proanima/arkvory-application';

/** Catalog mutation journal after a decimal sequence cursor; at most 100 entries per call. */
export async function readCatalogAudit(
  pool: Pool,
  repository: string,
  after: string,
): Promise<readonly CatalogAuditEntry[]> {
  const result = await pool.query<{
    sequence: string;
    actor: string;
    action: string;
    artifact_id: string;
    occurred_at: Date;
  }>(
    'SELECT sequence::text,actor,action,artifact_id,occurred_at FROM arkvory_audit WHERE repository=$1 AND sequence>$2::bigint ORDER BY sequence LIMIT 100',
    [repository, after],
  );
  return result.rows.map((row) => ({
    sequence: row.sequence,
    actor: row.actor,
    action: row.action,
    artifactId: row.artifact_id,
    occurredAt: row.occurred_at.toISOString(),
  }));
}

export interface CatalogAuditRow {
  readonly repository: string;
  readonly artifactId: string;
  readonly actor: string;
  readonly action: string;
}
/**
 * Caller owns the transaction: audit rows commit or roll back with the change they describe.
 * Rows receive sequence numbers in array order. requestId is the stored correlation or NULL.
 */
export async function appendCatalogAudit(
  client: PoolClient,
  rows: readonly CatalogAuditRow[],
  requestId: string | null,
): Promise<void> {
  await client.query(
    `INSERT INTO arkvory_audit(repository,artifact_id,actor,action,request_id)
     SELECT t.repository, t.artifact_id, t.actor, t.action, $5
     FROM unnest($1::text[], $2::uuid[], $3::text[], $4::text[])
       WITH ORDINALITY AS t(repository, artifact_id, actor, action, position)
     ORDER BY t.position`,
    [
      rows.map((row) => row.repository),
      rows.map((row) => row.artifactId),
      rows.map((row) => row.actor),
      rows.map((row) => row.action),
      requestId,
    ],
  );
}

/** Owner-scoped retention reference; adding and removing are idempotent in the catalog change. */
export async function writeReference(
  client: PoolClient,
  reference: { repository: string; id: string; owner: string; key: string; remove: boolean },
): Promise<void> {
  const { repository, id, owner, key } = reference;
  if (reference.remove)
    await client.query(
      'DELETE FROM arkvory_references WHERE repository=$1 AND artifact_id=$2 AND owner=$3 AND reference=$4',
      [repository, id, owner, key],
    );
  else
    await client.query(
      'INSERT INTO arkvory_references(repository,artifact_id,owner,reference) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
      [repository, id, owner, key],
    );
}
