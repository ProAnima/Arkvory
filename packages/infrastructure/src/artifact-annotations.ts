import type { Pool, PoolClient } from 'pg';
import { ArkvoryError, parseDescriptor } from '@proanima/arkvory-domain';
import type { Annotation } from '@proanima/arkvory-application';

/** Current annotation; revision 0 means the upload descriptor values were never replaced. */
export async function readAnnotation(
  pool: Pool,
  repository: string,
  id: string,
): Promise<Annotation> {
  const result = await pool.query<{
    revision: number | null;
    labels: unknown;
    metadata: unknown;
    collections: unknown;
    descriptor: unknown;
  }>(
    `SELECT a.revision,a.labels,a.metadata,a.collections,u.descriptor FROM arkvory_uploads u LEFT JOIN arkvory_annotations a ON a.artifact_id=u.id WHERE u.repository=$1 AND u.id=$2 AND u.status='available'`,
    [repository, id],
  );
  const row = result.rows[0];
  if (!row) throw new ArkvoryError('not_found', 'Artifact not found');
  const original = parseDescriptor(row.descriptor);
  if (row.revision === null)
    return { revision: 0, labels: original.labels, metadata: original.metadata, collections: [] };
  const fields = parseDescriptor({
    ...original,
    size: String(original.size),
    labels: row.labels,
    metadata: row.metadata,
  });
  const collections = parseDescriptor({
    ...original,
    size: String(original.size),
    labels: row.collections,
  }).labels;
  return {
    revision: row.revision,
    labels: fields.labels,
    metadata: fields.metadata,
    collections,
  };
}

/**
 * Compare-and-set replacement inside the caller's catalog transaction: expected 0 creates the
 * first revision, otherwise only the exact current revision is advanced. A lost race is a conflict.
 */
export async function writeAnnotation(
  client: PoolClient,
  repository: string,
  id: string,
  expected: number,
  value: Omit<Annotation, 'revision'>,
): Promise<Annotation> {
  const result = await client.query(
    `INSERT INTO arkvory_annotations(artifact_id,revision,labels,metadata,collections) SELECT id,1,$3,$4,$5 FROM arkvory_uploads WHERE id=$1 AND repository=$2 AND status='available' AND $6::integer=0 ON CONFLICT(artifact_id) DO NOTHING`,
    [
      id,
      repository,
      JSON.stringify(value.labels),
      JSON.stringify(value.metadata),
      JSON.stringify(value.collections),
      expected,
    ],
  );
  if (expected > 0) {
    const updated = await client.query(
      'UPDATE arkvory_annotations SET revision=revision+1,labels=$3,metadata=$4,collections=$5 WHERE artifact_id=$1 AND revision=$2',
      [
        id,
        expected,
        JSON.stringify(value.labels),
        JSON.stringify(value.metadata),
        JSON.stringify(value.collections),
      ],
    );
    if (updated.rowCount !== 1)
      throw new ArkvoryError('conflict', 'Annotation revision changed', {
        reason: 'revision_mismatch',
      });
  } else if (result.rowCount !== 1)
    throw new ArkvoryError('conflict', 'Annotation revision changed', {
      reason: 'revision_mismatch',
    });
  return { revision: expected + 1, ...value };
}
