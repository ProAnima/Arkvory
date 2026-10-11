import type { Pool } from 'pg';
import type {
  PackageCandidate,
  PackageCandidateStore,
  PackageQuery,
} from '@proanima/arkvory-application';

interface CandidateRow {
  package_group: string;
  name: string;
  version: string;
  artifact_id: string;
  sha256: string;
  size: string;
  published_at: Date | null;
  staged_at: Date | null;
  /** The sort position as text: exact, unlike a Date, for the next page's condition. */
  cursor_key: string;
}
const candidate = (row: CandidateRow): PackageCandidate => ({
  group: row.package_group,
  name: row.name,
  version: row.version,
  artifactId: row.artifact_id,
  sha256: row.sha256,
  size: row.size,
  publishedAt: (row.published_at ?? new Date(0)).toISOString(),
  stagedAt: row.staged_at?.toISOString() ?? null,
});

/** Parameters: $1 repository, $2 group, $3 name, then $4 stage when filtering by stage. */
function select(staged: boolean): string {
  return `SELECT p.package_group, p.name, p.version, p.artifact_id,
      u.descriptor->>'sha256' AS sha256, u.size::text AS size, u.published_at,
      ${staged ? 's.promoted_at' : 'NULL::timestamptz'} AS staged_at,
      ${staged ? 's.promoted_at::text' : 'arkvory_semver_key(p.version)'} AS cursor_key
    FROM arkvory_packages p
    JOIN arkvory_uploads u ON u.id=p.artifact_id AND u.status='available'
    ${staged ? 'JOIN arkvory_artifact_stages s ON s.repository=p.repository AND s.artifact_id=p.artifact_id AND s.stage=$4' : ''}
    WHERE p.repository=$1 AND lower(p.package_group COLLATE "C")=lower($2 COLLATE "C")
      AND lower(p.name COLLATE "C")=lower($3 COLLATE "C")`;
}

function parseCursor(cursor: string): [string, string, string] {
  const value: unknown = JSON.parse(cursor);
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !value.every((part) => typeof part === 'string')
  )
    throw new Error('Invalid package page cursor');
  return value as [string, string, string];
}

export class PostgresPackageCandidates implements PackageCandidateStore {
  constructor(private readonly pool: Pool) {}

  /**
   * Keyset pages (ADR 0075): each page continues after the last row's sort position instead of
   * skipping an offset, so a deep scan of a package with many versions sorts nothing twice.
   */
  async candidates(
    repository: string,
    query: Pick<PackageQuery, 'group' | 'name' | 'stage' | 'order'>,
    cursor: string | null,
    limit: number,
  ) {
    const params: unknown[] = [repository, query.group, query.name];
    if (query.stage !== undefined) params.push(query.stage);
    const promoted = query.order === 'promoted' && query.stage !== undefined;
    // The cursor of the stage order is the promotion time; select it as such for that order.
    const sql = select(query.stage !== undefined).replace(
      's.promoted_at::text AS cursor_key',
      promoted
        ? 's.promoted_at::text AS cursor_key'
        : 'arkvory_semver_key(p.version) AS cursor_key',
    );
    const order = promoted
      ? 's.promoted_at DESC, p.artifact_id'
      : 'arkvory_semver_key(p.version) COLLATE "C" DESC, p.version COLLATE "C", p.artifact_id';
    let after = '';
    if (cursor !== null) {
      const [key, version, artifact] = parseCursor(cursor);
      // Only the parameters a condition uses: PostgreSQL cannot type an unused one.
      const k = params.push(key);
      const v = promoted ? 0 : params.push(version);
      const a = params.push(artifact);
      after = promoted
        ? ` AND (s.promoted_at < $${String(k)}::timestamptz
             OR (s.promoted_at = $${String(k)}::timestamptz AND p.artifact_id > $${String(a)}::uuid))`
        : ` AND (arkvory_semver_key(p.version) COLLATE "C" < $${String(k)} COLLATE "C"
             OR (arkvory_semver_key(p.version) COLLATE "C" = $${String(k)} COLLATE "C"
                 AND (p.version COLLATE "C" > $${String(v)} COLLATE "C"
                      OR (p.version COLLATE "C" = $${String(v)} COLLATE "C"
                          AND p.artifact_id > $${String(a)}::uuid))))`;
    }
    const result = await this.pool.query<CandidateRow>(
      `${sql}${after} ORDER BY ${order} LIMIT $${String(params.push(limit))}`,
      params,
    );
    const last = result.rows.at(-1);
    return {
      items: result.rows.map(candidate),
      cursor:
        last && result.rows.length === limit
          ? JSON.stringify([last.cursor_key, last.version, last.artifact_id])
          : null,
    };
  }

  async exact(
    repository: string,
    query: Pick<PackageQuery, 'group' | 'name' | 'stage'> & { version: string },
  ) {
    const params: unknown[] = [repository, query.group, query.name];
    if (query.stage !== undefined) params.push(query.stage);
    const result = await this.pool.query<CandidateRow>(
      `${select(query.stage !== undefined)} AND lower(p.version)=lower($${String(params.length + 1)}) LIMIT 1`,
      [...params, query.version],
    );
    const row = result.rows[0];
    return row ? candidate(row) : null;
  }
}
