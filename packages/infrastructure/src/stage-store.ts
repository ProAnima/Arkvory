import type { Pool } from 'pg';
import type { MutationAccess } from '@proanima/arkvory-domain';
import type { Page, PromotionEvent, StageEntry, StageStore } from '@proanima/arkvory-application';
import { lockCatalogMutation, requirePublished } from './catalog-mutation.js';
import { lockServiceAccess } from './service-authorization.js';
import { inTransaction } from './pg-transaction.js';
import { accessCorrelation } from './request-correlation.js';
import {
  addStageInTransaction,
  promotionEvent,
  recordPromotionEvent,
  stageEntry,
} from './stage-events.js';
import type { EventRow, StageRow } from './stage-events.js';

export class PostgresStages implements StageStore {
  constructor(private readonly pool: Pool) {}

  async stages(repository: string, id: string) {
    const result = await this.pool.query<StageRow>(
      'SELECT * FROM arkvory_artifact_stages WHERE repository=$1 AND artifact_id=$2 ORDER BY stage',
      [repository, id],
    );
    return result.rows.map(stageEntry);
  }

  async stagedArtifacts(
    repository: string,
    stage: string | undefined,
    after: string | undefined,
    limit: number,
    ids?: readonly string[],
  ): Promise<Page<StageEntry>> {
    const [afterId = null, afterStage = ''] = after?.split('/') ?? [];
    const result = await this.pool.query<StageRow>(
      `SELECT s.* FROM arkvory_artifact_stages s
       JOIN arkvory_uploads u ON u.id=s.artifact_id AND u.status='available'
       WHERE s.repository=$1 AND ($2::text IS NULL OR s.stage=$2)
         AND ($3::uuid IS NULL OR (s.artifact_id, s.stage COLLATE "C") > ($3::uuid, $4::text COLLATE "C"))
         AND ($6::uuid[] IS NULL OR s.artifact_id = ANY($6::uuid[]))
       ORDER BY s.artifact_id, s.stage COLLATE "C" LIMIT $5`,
      [repository, stage ?? null, afterId, afterStage, limit + 1, ids ?? null],
    );
    const items = result.rows.slice(0, limit).map(stageEntry);
    const last = items.at(-1);
    return {
      items,
      next: result.rows.length > limit && last ? `${last.artifactId}/${last.stage}` : null,
    };
  }

  setStage(access: MutationAccess, id: string, stage: string, comment: string | null) {
    return inTransaction(this.pool, async (client) => {
      await lockServiceAccess(client, access);
      await lockCatalogMutation(client, access.repository);
      await requirePublished(client, access.repository, id);
      return addStageInTransaction(
        client,
        access.repository,
        id,
        stage,
        access.principal.id,
        comment,
        accessCorrelation(access),
      );
    });
  }

  removeStage(access: MutationAccess, id: string, stage: string) {
    return inTransaction(this.pool, async (client) => {
      await lockServiceAccess(client, access);
      await lockCatalogMutation(client, access.repository);
      await requirePublished(client, access.repository, id);
      const removed = await client.query(
        'DELETE FROM arkvory_artifact_stages WHERE repository=$1 AND artifact_id=$2 AND stage=$3',
        [access.repository, id, stage],
      );
      if (!removed.rowCount) return false;
      await recordPromotionEvent(client, {
        repository: access.repository,
        artifactId: id,
        action: 'stage.removed',
        stage,
        actor: access.principal.id,
        requestId: accessCorrelation(access),
      });
      return true;
    });
  }

  async events(
    repository: string,
    id: string | undefined,
    after: string | undefined,
    limit: number,
  ): Promise<Page<PromotionEvent>> {
    const result = await this.pool.query<EventRow>(
      `SELECT * FROM arkvory_promotion_events
       WHERE repository=$1 AND ($2::uuid IS NULL OR artifact_id=$2) AND ($3::bigint IS NULL OR sequence>$3)
       ORDER BY sequence LIMIT $4`,
      [repository, id ?? null, after ?? null, limit + 1],
    );
    const items = result.rows.slice(0, limit).map(promotionEvent);
    return {
      items,
      next: result.rows.length > limit ? (items.at(-1)?.sequence ?? null) : null,
    };
  }
}
