import type { Pool, PoolClient } from 'pg';
import {
  OciError,
  isOciDigest,
  ociFeedActions,
  ociManifestDetail,
  ociTagDetail,
} from '@proanima/arkvory-domain';
import type { Principal } from '@proanima/arkvory-domain';
import type { OciIndex, OciManifestRecord, OciUploadState } from '@proanima/arkvory-application';
import { inTransaction } from './pg-transaction.js';
import { lockCatalogMutation } from './catalog-mutation.js';
import { appendCatalogAudit } from './catalog-audit.js';
import { storedCorrelation } from './request-correlation.js';

interface ManifestRow {
  digest: string;
  artifact_id: string;
  media_type: string;
}
const manifestOf = (row: ManifestRow): OciManifestRecord => ({
  digest: row.digest,
  artifactId: row.artifact_id,
  mediaType: row.media_type,
});

/** One feed entry of a registry change, in the caller's transaction. */
function journal(
  client: PoolClient,
  actor: Principal,
  entry: { repository: string; artifactId: string; action: string; detail: string },
): Promise<void> {
  return appendCatalogAudit(
    client,
    [{ ...entry, actor: actor.id }],
    storedCorrelation(actor.requestId),
  );
}

/**
 * Registry rows in PostgreSQL (ADR 0063); the artifacts keep the bytes. Every change takes the
 * repository's catalog lock and journals itself in the same transaction: the feed order is the
 * commit order (mirrors follow it, ADR 0058), and retention, which deletes under that lock,
 * sees committed references.
 */
export class PostgresOciIndex implements OciIndex {
  constructor(private readonly pool: Pool) {}

  async blob(repository: string, digest: string): Promise<string | null> {
    const result = await this.pool.query<{ artifact_id: string }>(
      'SELECT artifact_id::text FROM arkvory_oci_blobs WHERE repository=$1 AND digest=$2',
      [repository, digest],
    );
    return result.rows[0]?.artifact_id ?? null;
  }

  async addBlob(
    actor: Principal,
    repository: string,
    digest: string,
    artifactId: string,
  ): Promise<void> {
    await inTransaction(this.pool, async (client) => {
      await lockCatalogMutation(client, repository);
      await client.query(
        `INSERT INTO arkvory_oci_blobs(repository,digest,artifact_id) VALUES($1,$2,$3)
         ON CONFLICT (repository,digest) DO UPDATE SET artifact_id=EXCLUDED.artifact_id`,
        [repository, digest, artifactId],
      );
      await journal(client, actor, {
        repository,
        artifactId,
        action: ociFeedActions.blob,
        detail: digest,
      });
    });
  }

  async manifest(
    repository: string,
    image: string,
    reference: string,
  ): Promise<OciManifestRecord | null> {
    const result = await this.pool.query<ManifestRow>(
      isOciDigest(reference)
        ? `SELECT digest, artifact_id::text, media_type FROM arkvory_oci_manifests
           WHERE repository=$1 AND image=$2 AND digest=$3`
        : `SELECT m.digest, m.artifact_id::text, m.media_type FROM arkvory_oci_tags t
           JOIN arkvory_oci_manifests m
             ON m.repository=t.repository AND m.image=t.image AND m.digest=t.digest
           WHERE t.repository=$1 AND t.image=$2 AND t.tag=$3`,
      [repository, image, reference],
    );
    const row = result.rows[0];
    return row ? manifestOf(row) : null;
  }

  async putManifest(
    actor: Principal,
    repository: string,
    image: string,
    manifest: OciManifestRecord & { readonly references: readonly string[] },
    tag: string | null,
  ): Promise<void> {
    await inTransaction(this.pool, async (client) => {
      // Retention deletes under the same lock and spares referenced content: once these rows
      // commit, the manifest and everything it references stay until the manifest is deleted.
      await lockCatalogMutation(client, repository);
      const missing = await client.query(
        `SELECT 1 FROM unnest($3::text[]) AS target WHERE NOT EXISTS(
           SELECT 1 FROM arkvory_oci_blobs b JOIN arkvory_uploads u ON u.id=b.artifact_id
           WHERE b.repository=$1 AND b.digest=target AND u.status='available')
         AND NOT EXISTS(
           SELECT 1 FROM arkvory_oci_manifests m JOIN arkvory_uploads u ON u.id=m.artifact_id
           WHERE m.repository=$1 AND m.image=$2 AND m.digest=target AND u.status='available')
         UNION ALL SELECT 1 WHERE NOT EXISTS(
           SELECT 1 FROM arkvory_uploads WHERE id=$4 AND repository=$1 AND status='available')`,
        [repository, image, manifest.references, manifest.artifactId],
      );
      if (missing.rowCount)
        throw new OciError('MANIFEST_BLOB_UNKNOWN', 'Referenced content is no longer available');
      // A repeated push of the same digest keeps the row; a vanished artifact is replaced.
      await client.query(
        `INSERT INTO arkvory_oci_manifests(repository,image,digest,artifact_id,media_type)
         VALUES($1,$2,$3,$4,$5)
         ON CONFLICT (repository,image,digest)
         DO UPDATE SET artifact_id=EXCLUDED.artifact_id, media_type=EXCLUDED.media_type`,
        [repository, image, manifest.digest, manifest.artifactId, manifest.mediaType],
      );
      await client.query(
        `INSERT INTO arkvory_oci_references(repository,image,manifest,target)
         SELECT $1,$2,$3,target FROM unnest($4::text[]) AS target ON CONFLICT DO NOTHING`,
        [repository, image, manifest.digest, manifest.references],
      );
      const { artifactId, digest } = manifest;
      await journal(client, actor, {
        repository,
        artifactId,
        action: ociFeedActions.manifest,
        detail: ociManifestDetail(image, digest),
      });
      if (tag === null) return;
      await client.query(
        `INSERT INTO arkvory_oci_tags(repository,image,tag,digest) VALUES($1,$2,$3,$4)
         ON CONFLICT (repository,image,tag)
         DO UPDATE SET digest=EXCLUDED.digest, updated_at=now()`,
        [repository, image, tag, digest],
      );
      await journal(client, actor, {
        repository,
        artifactId,
        action: ociFeedActions.tag,
        detail: ociTagDetail(image, tag),
      });
    });
  }

  async deleteManifest(
    actor: Principal,
    repository: string,
    image: string,
    digest: string,
  ): Promise<boolean> {
    return inTransaction(this.pool, async (client) => {
      await lockCatalogMutation(client, repository);
      // Tags and references go with the manifest by ON DELETE CASCADE.
      const removed = await client.query<{ artifact_id: string }>(
        `DELETE FROM arkvory_oci_manifests WHERE repository=$1 AND image=$2 AND digest=$3
         RETURNING artifact_id::text`,
        [repository, image, digest],
      );
      const artifactId = removed.rows[0]?.artifact_id;
      if (artifactId === undefined) return false;
      await journal(client, actor, {
        repository,
        artifactId,
        action: ociFeedActions.manifestDeleted,
        detail: ociManifestDetail(image, digest),
      });
      return true;
    });
  }

  async deleteTag(
    actor: Principal,
    repository: string,
    image: string,
    tag: string,
  ): Promise<boolean> {
    return inTransaction(this.pool, async (client) => {
      await lockCatalogMutation(client, repository);
      const removed = await client.query<{ artifact_id: string }>(
        `DELETE FROM arkvory_oci_tags t USING arkvory_oci_manifests m
         WHERE t.repository=$1 AND t.image=$2 AND t.tag=$3
           AND m.repository=t.repository AND m.image=t.image AND m.digest=t.digest
         RETURNING m.artifact_id::text`,
        [repository, image, tag],
      );
      const artifactId = removed.rows[0]?.artifact_id;
      if (artifactId === undefined) return false;
      await journal(client, actor, {
        repository,
        artifactId,
        action: ociFeedActions.tagDeleted,
        detail: ociTagDetail(image, tag),
      });
      return true;
    });
  }

  async tags(
    repository: string,
    image: string,
    after: string | null,
    limit: number,
  ): Promise<string[]> {
    const result = await this.pool.query<{ tag: string }>(
      `SELECT tag FROM arkvory_oci_tags WHERE repository=$1 AND image=$2
       AND ($3::text IS NULL OR tag COLLATE "C" > $3::text COLLATE "C") ORDER BY tag COLLATE "C" LIMIT $4`,
      [repository, image, after, limit],
    );
    return result.rows.map((row) => row.tag);
  }

  async startUpload(state: OciUploadState): Promise<void> {
    await this.pool.query(
      `INSERT INTO arkvory_oci_uploads(id,repository,image,owner,received)
       VALUES($1,$2,$3,$4,$5)`,
      [state.id, state.repository, state.image, state.owner, state.received],
    );
  }

  async upload(id: string): Promise<OciUploadState | null> {
    const result = await this.pool.query<{
      id: string;
      repository: string;
      image: string;
      owner: string;
      received: string;
    }>(
      `SELECT id::text, repository, image, owner, received::text FROM arkvory_oci_uploads
       WHERE id=$1`,
      [id],
    );
    const row = result.rows[0];
    return row ? { ...row, received: Number(row.received) } : null;
  }

  async setReceived(id: string, received: number): Promise<void> {
    await this.pool.query(
      'UPDATE arkvory_oci_uploads SET received=$2, updated_at=now() WHERE id=$1',
      [id, received],
    );
  }

  async endUpload(id: string): Promise<void> {
    await this.pool.query('DELETE FROM arkvory_oci_uploads WHERE id=$1', [id]);
  }

  async expireUploads(seconds: number, limit: number): Promise<string[]> {
    const result = await this.pool.query<{ id: string }>(
      `DELETE FROM arkvory_oci_uploads WHERE id IN (
         SELECT id FROM arkvory_oci_uploads
         WHERE updated_at < now() - make_interval(secs => $1) ORDER BY updated_at LIMIT $2)
       RETURNING id::text`,
      [seconds, limit],
    );
    return result.rows.map((row) => row.id);
  }
}
