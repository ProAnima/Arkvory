import type { Pool } from 'pg';
import type { ArtifactSearchItem } from '@proanima/arkvory-application';

interface SearchRow {
  id: string;
  name: string;
  size: string;
  created_at: Date;
  published_at: Date | null;
  labels: unknown;
  stages: unknown;
}

/** Stored JSON/array columns stay unknown until checked; corruption is a server fault, not input. */
function storedStrings(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value)) throw new Error(`Stored artifact ${field} are corrupt`);
  const entries: readonly unknown[] = value;
  const result: string[] = [];
  for (const entry of entries) {
    if (typeof entry !== 'string') throw new Error(`Stored artifact ${field} are corrupt`);
    result.push(entry);
  }
  return result;
}

function searchItem(row: SearchRow): ArtifactSearchItem {
  return {
    id: row.id,
    name: row.name,
    size: row.size,
    createdAt: row.created_at.toISOString(),
    publishedAt: row.published_at?.toISOString() ?? null,
    labels: storedStrings(row.labels, 'labels'),
    stages: storedStrings(row.stages, 'stages'),
  };
}

/**
 * One bounded statement: the CTE selects the page (at most 100 artifacts) and stages are read
 * only for those rows through the (repository, artifact_id, stage) primary key, at most
 * MAX_STAGES each. Filters are unchanged; labels are the same current labels the filter matches.
 */
export async function searchArtifacts(
  pool: Pool,
  repository: string,
  query: string,
  label: string,
  collection: string,
  after: string | undefined,
  metadata?: { key: string; value: string },
): Promise<readonly ArtifactSearchItem[]> {
  const result = await pool.query<SearchRow>(
    `WITH page AS (
       SELECT u.id, u.descriptor->>'name' AS name, u.size::text AS size, u.created_at, u.published_at,
              COALESCE(a.labels,u.descriptor->'labels','[]'::jsonb) AS labels
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
       ORDER BY u.id LIMIT 100
     )
     SELECT p.*, ARRAY(
         SELECT s.stage::text FROM arkvory_artifact_stages s
         WHERE s.repository=$1 AND s.artifact_id=p.id ORDER BY s.stage COLLATE "C"
       ) AS stages
     FROM page p ORDER BY p.id`,
    [
      repository,
      after ?? null,
      query,
      label,
      collection,
      metadata ? JSON.stringify({ [metadata.key]: metadata.value }) : null,
    ],
  );
  return result.rows.map(searchItem);
}
