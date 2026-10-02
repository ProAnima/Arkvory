import type { Pool, PoolClient } from 'pg';
import { ArkvoryError, parseDescriptor, partBytesFor } from '@proanima/arkvory-domain';
import type { ArtifactDescriptor, Upload } from '@proanima/arkvory-domain';
import type {
  BlobStore,
  Catalog,
  PromotionInput,
  PromotionResult,
  PromotionStore,
} from '@proanima/arkvory-application';
import { lockCatalogMutation } from './catalog-mutation.js';
import { lockServiceAccess } from './service-authorization.js';
import { appendCatalogAudit } from './catalog-audit.js';
import { accessCorrelation } from './request-correlation.js';
import { removeArtifactInTransaction } from './retention.js';
import { addStageInTransaction, recordPromotionEvent } from './stage-events.js';
import { inTransaction } from './pg-transaction.js';

interface SourceRow {
  descriptor: unknown;
  storage_backend: string | null;
  package_group: string | null;
  name: string | null;
  version: string | null;
}
interface Source {
  descriptor: ArtifactDescriptor;
  backend: string | undefined;
  identity: { group: string; name: string; version: string } | null;
}
const noCancellation = { throwIfAborted() {} };

/**
 * Promotion never streams bytes: the copy is reserved as a pending upload, its blob is linked
 * outside any transaction, and one transaction publishes it with metadata, stages, events and,
 * for move, the source retirement. A crash leaves only an expiring pending reservation.
 */
export class PostgresPromotions implements PromotionStore {
  constructor(
    private readonly pool: Pool,
    private readonly catalog: Pick<Catalog, 'create'> & { readonly active: boolean },
    private readonly blobs: Pick<BlobStore, 'duplicate'>,
  ) {}

  async promote(input: PromotionInput): Promise<PromotionResult> {
    const source = await this.source(input);
    const existing = await this.existingCopy(input, source);
    if (existing) return this.adopt(input, existing);
    const copyId = (await this.pendingCopy(input)) ?? (await this.reserve(input, source));
    await this.blobs.duplicate(input.id, copyId, source.descriptor, noCancellation, source.backend);
    return inTransaction(this.pool, (client) => this.publish(client, input, copyId));
  }

  private async source(input: PromotionInput): Promise<Source> {
    const row = (
      await this.pool.query<SourceRow>(
        `SELECT u.descriptor, u.storage_backend, p.package_group, p.name, p.version
         FROM arkvory_uploads u LEFT JOIN arkvory_packages p ON p.repository=u.repository AND p.artifact_id=u.id
         WHERE u.repository=$1 AND u.id=$2 AND u.status='available'`,
        [input.source.repository, input.id],
      )
    ).rows[0];
    if (!row) throw new ArkvoryError('not_found', 'Artifact not found');
    const identity =
      row.name !== null && row.version !== null
        ? { group: row.package_group ?? '', name: row.name, version: row.version }
        : null;
    return {
      descriptor: parseDescriptor(row.descriptor),
      backend: row.storage_backend ?? undefined,
      identity,
    };
  }

  /** A published copy of this source, or the same package bytes already present in the target. */
  private async existingCopy(input: PromotionInput, source: Source): Promise<string | null> {
    const copy = await this.pool.query<{ id: string }>(
      `SELECT p.target_artifact_id AS id FROM arkvory_promotions p
       JOIN arkvory_uploads u ON u.id=p.target_artifact_id AND u.status='available'
       WHERE p.source_artifact_id=$1 AND p.target_repository=$2 AND p.state='published' LIMIT 1`,
      [input.id, input.target.repository],
    );
    if (copy.rows[0]) return copy.rows[0].id;
    if (!source.identity) return null;
    const same = await this.pool.query<{ id: string; sha256: string }>(
      `SELECT u.id, u.descriptor->>'sha256' AS sha256 FROM arkvory_packages p
       JOIN arkvory_uploads u ON u.id=p.artifact_id AND u.status='available'
       WHERE p.repository=$1 AND lower(p.package_group)=lower($2) AND lower(p.name)=lower($3)
         AND lower(p.version)=lower($4) LIMIT 1`,
      [
        input.target.repository,
        source.identity.group,
        source.identity.name,
        source.identity.version,
      ],
    );
    const match = same.rows[0];
    if (!match) return null;
    if (match.sha256 !== source.descriptor.sha256)
      throw new ArkvoryError(
        'conflict',
        'The target already has this package version with other bytes',
        { reason: 'version_exists' },
      );
    return match.id;
  }

  private async pendingCopy(input: PromotionInput): Promise<string | null> {
    const row = await this.pool.query<{ id: string }>(
      `SELECT p.target_artifact_id AS id FROM arkvory_promotions p
       JOIN arkvory_uploads u ON u.id=p.target_artifact_id AND u.status='pending' AND u.expires_at>now()
       WHERE p.source_artifact_id=$1 AND p.target_repository=$2 AND p.state='pending' AND u.owner=$3
       ORDER BY p.created_at DESC LIMIT 1`,
      [input.id, input.target.repository, input.target.principal.id],
    );
    return row.rows[0]?.id ?? null;
  }

  /** Capacity and quota apply to the copy exactly as to a new upload of the same descriptor. */
  private async reserve(input: PromotionInput, source: Source): Promise<string> {
    const upload: Upload = await this.catalog.create({
      id: input.copyId,
      repository: input.target.repository,
      owner: input.target.principal.id,
      key: `promotion:${input.copyId}`,
      descriptor: source.descriptor,
      createdAt: input.now,
      ...(source.backend === undefined ? {} : { storageBackend: source.backend }),
      partBytes: partBytesFor(source.descriptor.size),
      access: input.target,
    });
    await this.pool.query(
      `INSERT INTO arkvory_promotions(target_artifact_id,source_artifact_id,source_repository,target_repository,mode,state)
       VALUES($1,$2,$3,$4,$5,'pending') ON CONFLICT (target_artifact_id) DO NOTHING`,
      [upload.id, input.id, input.source.repository, input.target.repository, input.mode],
    );
    return upload.id;
  }

  private async lock(client: PoolClient, input: PromotionInput) {
    await client.query('SELECT pg_advisory_xact_lock(18473, hashtext($1))', [
      `${input.id}>${input.target.repository}`,
    ]);
    await lockServiceAccess(client, input.source);
    await lockServiceAccess(client, input.target);
    // Sorted repository gates keep concurrent promotions in opposite directions deadlock free.
    for (const repository of [input.source.repository, input.target.repository].sort())
      await lockCatalogMutation(client, repository);
    const live = await client.query(
      "SELECT 1 FROM arkvory_uploads WHERE repository=$1 AND id=$2 AND status='available' FOR SHARE",
      [input.source.repository, input.id],
    );
    if (!live.rowCount) throw new ArkvoryError('not_found', 'Artifact not found');
  }

  private async publish(client: PoolClient, input: PromotionInput, copyId: string) {
    await this.lock(client, input);
    const raced = await client.query<{ id: string }>(
      `SELECT p.target_artifact_id AS id FROM arkvory_promotions p
       JOIN arkvory_uploads u ON u.id=p.target_artifact_id AND u.status='available'
       WHERE p.source_artifact_id=$1 AND p.target_repository=$2 AND p.state='published' LIMIT 1`,
      [input.id, input.target.repository],
    );
    // A concurrent promotion won; this reservation expires and is reclaimed by cleanup.
    if (raced.rows[0]) return this.finish(client, input, raced.rows[0].id, false);
    if (!this.catalog.active) throw new ArkvoryError('unavailable', 'Storage ownership lost');
    const published = await client.query(
      "UPDATE arkvory_uploads SET status='available' WHERE id=$1 AND repository=$2 AND status='pending'",
      [copyId, input.target.repository],
    );
    if (published.rowCount !== 1)
      throw new ArkvoryError('conflict', 'Promotion reservation is no longer pending', {
        reason: 'state_conflict',
      });
    await client.query(
      `INSERT INTO arkvory_annotations(artifact_id,revision,labels,metadata,collections)
       SELECT $1,1,labels,metadata,collections FROM arkvory_annotations WHERE artifact_id=$2`,
      [copyId, input.id],
    );
    try {
      await client.query(
        `INSERT INTO arkvory_packages(repository,package_group,name,version,artifact_id,manifest)
         SELECT $1,package_group,name,version,$2,manifest FROM arkvory_packages
         WHERE repository=$3 AND artifact_id=$4`,
        [input.target.repository, copyId, input.source.repository, input.id],
      );
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505')
        throw new ArkvoryError('conflict', 'The target already has this package version', {
          reason: 'version_exists',
        });
      throw error;
    }
    await client.query(
      "UPDATE arkvory_promotions SET state='published',mode=$2 WHERE target_artifact_id=$1",
      [copyId, input.mode],
    );
    return this.finish(client, input, copyId, true);
  }

  private adopt(input: PromotionInput, targetId: string) {
    return inTransaction(this.pool, async (client) => {
      await this.lock(client, input);
      return this.finish(client, input, targetId, false);
    });
  }

  /** Stages, events and audit for the published copy; move retires the source last. */
  private async finish(
    client: PoolClient,
    input: PromotionInput,
    targetId: string,
    created: boolean,
  ): Promise<PromotionResult> {
    const actor = input.target.principal.id;
    const carried =
      input.mode === 'move'
        ? (
            await client.query<{ stage: string }>(
              'DELETE FROM arkvory_artifact_stages WHERE repository=$1 AND artifact_id=$2 RETURNING stage',
              [input.source.repository, input.id],
            )
          ).rows.map((row) => row.stage)
        : [];
    const stages = [...new Set([...input.stages, ...carried])].sort();
    for (const stage of stages)
      await addStageInTransaction(
        client,
        input.target.repository,
        targetId,
        stage,
        actor,
        input.comment,
        accessCorrelation(input.target),
      );
    if (created || input.mode === 'move') await this.record(client, input, targetId);
    if (input.mode === 'move') await this.retire(client, input);
    return {
      repository: input.target.repository,
      artifactId: targetId,
      sourceRepository: input.source.repository,
      sourceArtifactId: input.id,
      mode: input.mode,
      created,
      stages,
    };
  }

  private async record(client: PoolClient, input: PromotionInput, targetId: string) {
    const actor = input.target.principal.id;
    const shared = { actor, mode: input.mode, comment: input.comment };
    await recordPromotionEvent(client, {
      ...shared,
      repository: input.source.repository,
      artifactId: input.id,
      action: 'promoted',
      peerRepository: input.target.repository,
      peerArtifactId: targetId,
    });
    await recordPromotionEvent(client, {
      ...shared,
      repository: input.target.repository,
      artifactId: targetId,
      action: 'received',
      peerRepository: input.source.repository,
      peerArtifactId: input.id,
    });
    await appendCatalogAudit(
      client,
      [
        {
          repository: input.source.repository,
          artifactId: input.id,
          actor,
          action: 'artifact.promote',
        },
        {
          repository: input.target.repository,
          artifactId: targetId,
          actor,
          action: 'artifact.receive',
        },
      ],
      accessCorrelation(input.target),
    );
  }

  private async retire(client: PoolClient, input: PromotionInput) {
    const revision = await client.query<{ revision: number }>(
      'SELECT revision FROM arkvory_annotations WHERE artifact_id=$1',
      [input.id],
    );
    const outcome = await removeArtifactInTransaction(client, input.source, {
      id: input.id,
      expectedAnnotationRevision: revision.rows[0]?.revision ?? 0,
    });
    if (outcome.outcome === 'protected')
      throw new ArkvoryError(
        'conflict',
        `The source cannot be moved: ${outcome.blockers.join(', ')}`,
        { reason: 'state_conflict' },
      );
    if (outcome.outcome !== 'deleted' && outcome.outcome !== 'already_deleted')
      throw new ArkvoryError('conflict', 'The source changed during promotion', {
        reason: 'state_conflict',
      });
  }
}
