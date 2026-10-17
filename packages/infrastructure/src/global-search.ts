import type { Pool } from 'pg';
import type {
  GlobalSearchFilter,
  GlobalSearchRow,
  GlobalSearchStore,
} from '@proanima/arkvory-application';
import { inTransaction } from './pg-transaction.js';

interface Row {
  repository: string;
  id: string;
  name: string;
  size: string;
  created_at: Date;
  published_at: Date | null;
  micros: string;
  labels: unknown;
  stages: unknown;
}

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

/*
 * One statement per page. The sort key is the publication time (reservation time for rows that
 * never recorded one) in exact microseconds, so the keyset comparison never rounds. Stages are
 * read only for the page rows through the stage primary key. Substring filters scan the listed
 * repositories like the repository search (ADR 0075); the statement has its own short budget
 * below the pool's, and a timeout is reported as 503 unavailable by the error contract.
 */
const searchSql = `WITH page AS (
  SELECT u.repository, u.id, u.descriptor->>'name' AS name, u.size::text AS size, u.created_at,
         u.published_at, COALESCE(u.published_at, u.created_at) AS sort_at,
         COALESCE(a.labels, u.descriptor->'labels', '[]'::jsonb) AS labels
  FROM arkvory_uploads u
  LEFT JOIN arkvory_annotations a ON a.artifact_id = u.id
  WHERE u.repository = ANY($1::text[]) AND u.status = 'available'
    AND ($2 = '' OR strpos(lower(u.descriptor->>'name'), lower($2)) > 0
      OR EXISTS (
        SELECT 1 FROM jsonb_each_text(COALESCE(a.metadata, u.descriptor->'metadata', '{}'::jsonb)) m
        WHERE strpos(lower(m.value), lower($2)) > 0))
    AND COALESCE(a.labels, u.descriptor->'labels', '[]'::jsonb) ?& $3::text[]
    AND ($4::text IS NULL OR EXISTS (
      SELECT 1 FROM arkvory_artifact_stages s
      WHERE s.repository = u.repository AND s.artifact_id = u.id AND s.stage = $4))
    AND ($5::bigint IS NULL
      OR COALESCE(u.published_at, u.created_at) < 'epoch'::timestamptz + $5::bigint * interval '1 microsecond'
      OR (COALESCE(u.published_at, u.created_at) = 'epoch'::timestamptz + $5::bigint * interval '1 microsecond'
        AND (u.repository COLLATE "C" > $6 OR (u.repository = $6 AND u.id > $7::uuid))))
  ORDER BY sort_at DESC, u.repository COLLATE "C", u.id
  LIMIT $8
)
SELECT p.repository, p.id, p.name, p.size, p.created_at, p.published_at, p.labels,
       (extract(epoch FROM p.sort_at) * 1000000)::bigint::text AS micros,
       ARRAY(SELECT s.stage::text FROM arkvory_artifact_stages s
             WHERE s.repository = p.repository AND s.artifact_id = p.id
             ORDER BY s.stage COLLATE "C") AS stages
FROM page p ORDER BY p.sort_at DESC, p.repository COLLATE "C", p.id`;

/** Installation-wide search of ADR 0081 (A1) over repositories the caller was allowed. */
export class PostgresGlobalSearch implements GlobalSearchStore {
  constructor(
    private readonly pool: Pool,
    private readonly statementTimeoutMs = 5000,
  ) {}
  searchRepositories(filter: GlobalSearchFilter, limit: number): Promise<GlobalSearchRow[]> {
    // SET LOCAL needs a transaction; it ends with this page and returns the client clean.
    return inTransaction(this.pool, async (client) => {
      await client.query(`SET LOCAL statement_timeout = ${String(this.statementTimeoutMs)}`);
      const result = await client.query<Row>(searchSql, [
        filter.repositories,
        filter.query,
        filter.labels,
        filter.stage ?? null,
        filter.after?.micros ?? null,
        filter.after?.repository ?? null,
        filter.after?.id ?? null,
        limit,
      ]);
      return result.rows.map((row) => ({
        item: {
          repository: row.repository,
          id: row.id,
          name: row.name,
          size: row.size,
          createdAt: row.created_at.toISOString(),
          publishedAt: row.published_at?.toISOString() ?? null,
          labels: storedStrings(row.labels, 'labels'),
          stages: storedStrings(row.stages, 'stages'),
        },
        position: { micros: row.micros, repository: row.repository, id: row.id },
      }));
    });
  }
}
