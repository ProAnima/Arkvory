import type { Pool } from 'pg';
import { OciError, isOciDigest } from '@proanima/arkvory-domain';
import type { OciIndex, OciManifestRecord, OciUploadState } from '@proanima/arkvory-application';
import { inTransaction } from './pg-transaction.js';
import { lockCatalogMutation } from './catalog-mutation.js';

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

/** Registry rows in PostgreSQL (ADR 0063); the artifacts keep the bytes. */
export class PostgresOciIndex implements OciIndex {
  constructor(private readonly pool: Pool) {}

  async blob(repository: string, digest: string): Promise<string | null> {
    const result = await this.pool.query<{ artifact_id: string }>(
      'SELECT artifact_id::text FROM arkvory_oci_blobs WHERE repository=$1 AND digest=$2',
      [repository, digest],
    );
    return result.rows[0]?.artifact_id ?? null;
  }

  async addBlob(repository: string, digest: string, artifactId: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO arkvory_oci_blobs(repository,digest,artifact_id) VALUES($1,$2,$3)
       ON CONFLICT (repository,digest) DO UPDATE SET artifact_id=EXCLUDED.artifact_id`,
      [repository, digest, artifactId],
    );
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
      if (tag !== null)
        await client.query(
          `INSERT INTO arkvory_oci_tags(repository,image,tag,digest) VALUES($1,$2,$3,$4)
           ON CONFLICT (repository,image,tag)
           DO UPDATE SET digest=EXCLUDED.digest, updated_at=now()`,
          [repository, image, tag, manifest.digest],
        );
    });
  }

  async deleteManifest(repository: string, image: string, digest: string): Promise<boolean> {
    // Tags and references go with the manifest by ON DELETE CASCADE.
    const result = await this.pool.query(
      'DELETE FROM arkvory_oci_manifests WHERE repository=$1 AND image=$2 AND digest=$3',
      [repository, image, digest],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async deleteTag(repository: string, image: string, tag: string): Promise<boolean> {
    const result = await this.pool.query(
      'DELETE FROM arkvory_oci_tags WHERE repository=$1 AND image=$2 AND tag=$3',
      [repository, image, tag],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async tags(
    repository: string,
    image: string,
    after: string | null,
    limit: number,
  ): Promise<string[]> {
    const result = await this.pool.query<{ tag: string }>(
      `SELECT tag FROM arkvory_oci_tags WHERE repository=$1 AND image=$2
       AND ($3::text IS NULL OR tag > $3) ORDER BY tag COLLATE "C" LIMIT $4`,
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
