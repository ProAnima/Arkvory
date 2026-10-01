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
      ${staged ? 's.promoted_at' : 'NULL::timestamptz'} AS staged_at
    FROM arkvory_packages p
    JOIN arkvory_uploads u ON u.id=p.artifact_id AND u.status='available'
    ${staged ? 'JOIN arkvory_artifact_stages s ON s.repository=p.repository AND s.artifact_id=p.artifact_id AND s.stage=$4' : ''}
    WHERE p.repository=$1 AND lower(p.package_group COLLATE "C")=lower($2 COLLATE "C")
      AND lower(p.name COLLATE "C")=lower($3 COLLATE "C")`;
}

export class PostgresPackageCandidates implements PackageCandidateStore {
  constructor(private readonly pool: Pool) {}

  async candidates(
    repository: string,
    query: Pick<PackageQuery, 'group' | 'name' | 'stage' | 'order'>,
    offset: number,
    limit: number,
  ) {
    const params: unknown[] = [repository, query.group, query.name];
    if (query.stage !== undefined) params.push(query.stage);
    const order =
      query.order === 'promoted' && query.stage !== undefined
        ? 's.promoted_at DESC, p.artifact_id'
        : 'arkvory_semver_key(p.version) COLLATE "C" DESC, p.version COLLATE "C", p.artifact_id';
    const result = await this.pool.query<CandidateRow>(
      `${select(query.stage !== undefined)} ORDER BY ${order}
       OFFSET $${String(params.length + 1)} LIMIT $${String(params.length + 2)}`,
      [...params, offset, limit],
    );
    return result.rows.map(candidate);
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
