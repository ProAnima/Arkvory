import type { PoolClient } from 'pg';
import { ArkvoryError, MAX_STAGES } from '@proanima/arkvory-domain';
import type { PromotionMode } from '@proanima/arkvory-domain';
import type { PromotionAction, PromotionEvent, StageEntry } from '@proanima/arkvory-application';

export interface StageRow {
  artifact_id: string;
  stage: string;
  promoted_at: Date;
  actor: string;
  comment: string | null;
}
export interface EventRow {
  sequence: string;
  repository: string;
  artifact_id: string;
  action: PromotionAction;
  stage: string | null;
  mode: PromotionMode | null;
  peer_repository: string | null;
  peer_artifact_id: string | null;
  actor: string;
  comment: string | null;
  occurred_at: Date;
}
export const stageEntry = (row: StageRow): StageEntry => ({
  artifactId: row.artifact_id,
  stage: row.stage,
  promotedAt: row.promoted_at.toISOString(),
  actor: row.actor,
  comment: row.comment,
});
export const promotionEvent = (row: EventRow): PromotionEvent => ({
  sequence: row.sequence,
  repository: row.repository,
  artifactId: row.artifact_id,
  action: row.action,
  stage: row.stage,
  mode: row.mode,
  peerRepository: row.peer_repository,
  peerArtifactId: row.peer_artifact_id,
  actor: row.actor,
  comment: row.comment,
  occurredAt: row.occurred_at.toISOString(),
});

export interface PromotionEventInput {
  repository: string;
  artifactId: string;
  action: PromotionAction;
  actor: string;
  stage?: string | null;
  mode?: PromotionMode | null;
  peerRepository?: string | null;
  peerArtifactId?: string | null;
  comment?: string | null;
}
export async function recordPromotionEvent(client: PoolClient, input: PromotionEventInput) {
  await client.query(
    `INSERT INTO arkvory_promotion_events
       (repository,artifact_id,action,stage,mode,peer_repository,peer_artifact_id,actor,comment)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      input.repository,
      input.artifactId,
      input.action,
      input.stage ?? null,
      input.mode ?? null,
      input.peerRepository ?? null,
      input.peerArtifactId ?? null,
      input.actor,
      input.comment ?? null,
    ],
  );
}

/** Caller holds the repository catalog gate; re-adding a stage keeps its time and records nothing. */
export async function addStageInTransaction(
  client: PoolClient,
  repository: string,
  id: string,
  stage: string,
  actor: string,
  comment: string | null,
): Promise<StageEntry> {
  const inserted = await client.query<StageRow>(
    `INSERT INTO arkvory_artifact_stages(repository,artifact_id,stage,actor,comment)
     SELECT $1::text,$2::uuid,$3::text,$4::text,$5::text WHERE (SELECT count(*) FROM arkvory_artifact_stages
       WHERE repository=$1::text AND artifact_id=$2::uuid) < $6::integer
     ON CONFLICT (repository,artifact_id,stage) DO NOTHING RETURNING *`,
    [repository, id, stage, actor, comment, MAX_STAGES],
  );
  const row = inserted.rows[0];
  if (row) {
    await recordPromotionEvent(client, {
      repository,
      artifactId: id,
      action: 'stage.added',
      stage,
      actor,
      comment,
    });
    return stageEntry(row);
  }
  const existing = await client.query<StageRow>(
    'SELECT * FROM arkvory_artifact_stages WHERE repository=$1 AND artifact_id=$2 AND stage=$3',
    [repository, id, stage],
  );
  const current = existing.rows[0];
  if (!current)
    throw new ArkvoryError('conflict', `An artifact has at most ${String(MAX_STAGES)} stages`);
  return stageEntry(current);
}
