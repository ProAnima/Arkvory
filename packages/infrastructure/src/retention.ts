import type { Pool, PoolClient } from 'pg';
import { ArkvoryError } from '@proanima/arkvory-domain';
import type {
  MutationAccess,
  RetentionCriteria,
  DeletionSelection,
} from '@proanima/arkvory-domain';
import type {
  RetentionStore,
  DeletionCandidate,
  DeletionBlocker,
  DeletionResult,
} from '@proanima/arkvory-application';
import { lockServiceAccess } from './service-authorization.js';
import { appendCatalogAudit } from './catalog-audit.js';
import { accessCorrelation } from './request-correlation.js';
import { lockCatalogMutation } from './catalog-mutation.js';

export interface CandidateRow {
  id: string;
  name: string;
  size: string;
  published_at: Date;
  revision: number;
  referenced: boolean;
  asset: boolean;
  attached: boolean;
  labelled: boolean;
  staged: boolean;
}
export const candidateSql = `SELECT u.id,u.descriptor->>'name' AS name,u.size::text,u.published_at,
  COALESCE(a.revision,0) AS revision,
  (EXISTS(SELECT 1 FROM arkvory_references r WHERE r.repository=u.repository AND r.artifact_id=u.id) OR
   EXISTS(SELECT 1 FROM arkvory_oci_manifests m WHERE m.repository=u.repository AND m.artifact_id=u.id) OR
   EXISTS(SELECT 1 FROM arkvory_oci_blobs b JOIN arkvory_oci_references o
     ON o.repository=b.repository AND o.target=b.digest
     WHERE b.repository=u.repository AND b.artifact_id=u.id)) AS referenced,
  (EXISTS(SELECT 1 FROM arkvory_asset_revisions r WHERE r.artifact_id=u.id) OR
   EXISTS(SELECT 1 FROM arkvory_assets r WHERE r.artifact_id=u.id)) AS asset,
  EXISTS(SELECT 1 FROM arkvory_attachment_targets t WHERE t.target_id=u.id) AS attached,
  EXISTS(SELECT 1 FROM arkvory_artifact_stages s WHERE s.artifact_id=u.id) AS staged,
  COALESCE(a.labels,u.descriptor->'labels','[]'::jsonb) ?| $3::text[] AS labelled
  FROM arkvory_uploads u LEFT JOIN arkvory_annotations a ON a.artifact_id=u.id
  WHERE u.repository=$1 AND u.status='available'`;
export function candidate(row: CandidateRow): DeletionCandidate {
  const blockers: DeletionBlocker[] = [];
  if (row.referenced) blockers.push('reference');
  if (row.asset) blockers.push('asset_history');
  if (row.attached) blockers.push('attachment_history');
  if (row.labelled) blockers.push('protected_label');
  if (row.staged) blockers.push('promotion_stage');
  return {
    id: row.id,
    name: row.name,
    size: row.size,
    publishedAt: row.published_at.toISOString(),
    annotationRevision: row.revision,
    blockers,
  };
}
export class PostgresRetention implements RetentionStore {
  constructor(private readonly pool: Pool) {}
  async inspect(repository: string, id: string) {
    const row = (
      await this.pool.query<CandidateRow>(candidateSql + ' AND u.id=$2', [repository, id, []])
    ).rows[0];
    if (!row) throw new ArkvoryError('not_found', 'Artifact not found');
    return candidate(row);
  }
  async preview(repository: string, criteria: RetentionCriteria, limit: number, after?: string) {
    const result = await this.pool.query<CandidateRow>(
      candidateSql +
        ' AND ($2::uuid IS NULL OR u.id>$2) AND u.published_at<$4::timestamptz ORDER BY u.id LIMIT $5',
      [repository, after ?? null, criteria.protectedLabels, criteria.publishedBefore, limit + 1],
    );
    const items = result.rows.slice(0, limit).map(candidate);
    return { items, next: result.rows.length > limit ? (items.at(-1)?.id ?? null) : null };
  }
  async remove(
    access: MutationAccess,
    selected: readonly DeletionSelection[],
    criteria?: RetentionCriteria,
  ) {
    const client = await this.pool.connect();
    let broken = false;
    try {
      await client.query('BEGIN');
      await lockServiceAccess(client, access);
      await lockCatalogMutation(client, access.repository);
      const results: DeletionResult[] = [];
      for (const item of selected)
        results.push(await removeArtifactInTransaction(client, access, item, criteria));
      await client.query('COMMIT');
      return results;
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
}
// Internal primitive: caller must hold an open transaction, live access locks and the repository catalog gate.
export async function removeArtifactInTransaction(
  client: PoolClient,
  access: MutationAccess,
  item: DeletionSelection,
  criteria?: RetentionCriteria,
): Promise<DeletionResult> {
  const { repository, principal } = access;
  const result = (
    outcome: DeletionResult['outcome'],
    blockers: readonly DeletionBlocker[] = [],
  ): DeletionResult => ({ id: item.id, outcome, blockers });
  const previous = await client.query(
    'SELECT d.artifact_id FROM arkvory_artifact_deletions d JOIN arkvory_uploads u ON u.id=d.artifact_id WHERE u.repository=$1 AND u.id=$2',
    [repository, item.id],
  );
  if (previous.rowCount) return result('already_deleted');
  const row = (
    await client.query<CandidateRow>(candidateSql + ' AND u.id=$2', [
      repository,
      item.id,
      criteria?.protectedLabels ?? [],
    ])
  ).rows[0];
  if (!row) return result('not_found');
  const current = candidate(row);
  if (current.annotationRevision !== item.expectedAnnotationRevision) return result('changed');
  if (criteria && current.publishedAt >= criteria.publishedBefore) return result('not_eligible');
  if (current.blockers.length) return result('protected', current.blockers);
  // This transition never unlinks bytes. Offline maintenance reclaims them after its grace period.
  await client.query(
    "UPDATE arkvory_uploads SET status='cancelled',cancelled_at=now() WHERE id=$1 AND repository=$2 AND status='available'",
    [item.id, repository],
  );
  await client.query('INSERT INTO arkvory_artifact_deletions(artifact_id,actor) VALUES($1,$2)', [
    item.id,
    principal.id,
  ]);
  await appendCatalogAudit(
    client,
    [{ repository, artifactId: item.id, actor: principal.id, action: 'artifact.delete' }],
    accessCorrelation(access),
  );
  return result('deleted');
}
