import type { Pool } from 'pg';

export async function searchArtifacts(
  pool: Pool,
  repository: string,
  query: string,
  label: string,
  collection: string,
  after: string | undefined,
  metadata?: { key: string; value: string },
) {
  const result = await pool.query<{ id: string; name: string }>(
    `SELECT u.id, u.descriptor->>'name' AS name
     FROM arkvory_uploads u
     LEFT JOIN arkvory_annotations a ON a.artifact_id=u.id
     WHERE u.repository=$1 AND u.status='available'
       AND ($2::uuid IS NULL OR u.id>$2)
       AND ($3='' OR strpos(lower(u.descriptor->>'name'),lower($3))>0
         OR EXISTS (
           SELECT 1 FROM jsonb_each_text(COALESCE(a.metadata,u.descriptor->'metadata','{}'::jsonb)) m
           WHERE strpos(lower(m.value),lower($3))>0
         ))
       AND ($4='' OR COALESCE(a.labels,u.descriptor->'labels') ? $4)
       AND ($5='' OR a.collections ? $5)
       AND ($6::jsonb IS NULL OR COALESCE(a.metadata,u.descriptor->'metadata','{}'::jsonb) @> $6::jsonb)
     ORDER BY u.id LIMIT 100`,
    [
      repository,
      after ?? null,
      query,
      label,
      collection,
      metadata ? JSON.stringify({ [metadata.key]: metadata.value }) : null,
    ],
  );
  return result.rows;
}
