import type { Pool } from 'pg';
import { mirrorConflictCodes } from '@proanima/arkvory-application';
import type {
  MirrorConflict,
  MirrorConflictCode,
  MirrorConflictEntry,
  MirrorConflictReader,
  MirrorConflictStore,
  MirrorConflictSummary,
} from '@proanima/arkvory-application';

interface ConflictRow {
  artifact_id: string;
  action: string;
  detail: string | null;
  code: string;
  first_at: Date;
  last_at: Date;
  attempts: number;
}

/** A code written by a newer release is shown as the nearest one this release knows. */
const known = (code: string): MirrorConflictCode =>
  mirrorConflictCodes.find((candidate) => candidate === code) ?? 'mirror_package_conflict';

function decode(row: ConflictRow): MirrorConflict {
  return {
    artifactId: row.artifact_id,
    action: row.action,
    detail: row.detail,
    code: known(row.code),
    firstAt: row.first_at.toISOString(),
    lastAt: row.last_at.toISOString(),
    attempts: row.attempts,
  };
}

const columns = 'artifact_id::text, action, detail, code, first_at, last_at, attempts';
/** The `entry` column of an entry (schema 41): the MD5 of its action and detail. */
const entry = "md5($3::text || chr(10) || coalesce($4::text, ''))";

/** Entries of mirrored repositories put aside on a conflict (schema 41, ADR 0058). */
export class PostgresMirrorConflicts implements MirrorConflictStore, MirrorConflictReader {
  constructor(private readonly pool: Pool) {}

  async setAside(
    repository: string,
    conflict: MirrorConflictEntry,
    code: MirrorConflictCode,
    at: string,
  ): Promise<number> {
    const result = await this.pool.query<{ attempts: number }>(
      `INSERT INTO arkvory_mirror_conflicts(repository, artifact_id, entry, action, detail, code,
         first_at, last_at)
       VALUES($1, $2, ${entry}, $3, $4, $5, $6, $6)
       ON CONFLICT (repository, artifact_id, entry) DO UPDATE SET code=excluded.code, last_at=excluded.last_at,
         attempts=arkvory_mirror_conflicts.attempts + 1
       RETURNING attempts`,
      [repository, conflict.artifactId, conflict.action, conflict.detail, code, at],
    );
    return result.rows[0]?.attempts ?? 1;
  }

  async due(repository: string, before: string, limit: number): Promise<readonly MirrorConflict[]> {
    const result = await this.pool.query<ConflictRow>(
      `SELECT ${columns} FROM arkvory_mirror_conflicts WHERE repository=$1 AND last_at <= $2
       ORDER BY last_at, first_at LIMIT $3`,
      [repository, before, limit],
    );
    return result.rows.map(decode);
  }

  async resolve(repository: string, conflict: MirrorConflictEntry): Promise<void> {
    await this.pool.query(
      `DELETE FROM arkvory_mirror_conflicts WHERE repository=$1 AND artifact_id=$2 AND entry=${entry}`,
      [repository, conflict.artifactId, conflict.action, conflict.detail],
    );
  }

  async summary(repository: string, limit: number): Promise<MirrorConflictSummary> {
    const [total, sample] = await Promise.all([
      this.pool.query<{ count: string; oldest: Date | null }>(
        `SELECT count(*)::text AS count, min(first_at) AS oldest FROM arkvory_mirror_conflicts
         WHERE repository=$1`,
        [repository],
      ),
      this.pool.query<ConflictRow>(
        `SELECT ${columns} FROM arkvory_mirror_conflicts WHERE repository=$1
         ORDER BY first_at, artifact_id LIMIT $2`,
        [repository, limit],
      ),
    ]);
    const row = total.rows[0];
    return {
      count: Number(row?.count ?? 0),
      oldestAt: row?.oldest ? row.oldest.toISOString() : null,
      sample: sample.rows.map(decode),
    };
  }
}
