import type { Pool } from 'pg';
import { ArkvoryError } from '@proanima/arkvory-domain';
import { uploadLockKey } from './content-pins.js';
import { lockReservations, requireRoom } from './upload-bytes.js';
import type {
  MirrorPhase,
  MirrorSeedStep,
  MirrorState,
  MirrorStateStore,
} from '@proanima/arkvory-application';

interface StateRow {
  repository: string;
  source: string;
  phase: MirrorPhase;
  seed_step: MirrorSeedStep | null;
  seed_after: string | null;
  seed_head: string | null;
  cursor: string;
  head: string | null;
  checked_at: Date | null;
  synced_at: Date | null;
  error_code: string | null;
  error_at: Date | null;
  copied_artifacts: string;
  copied_bytes: string;
  anchor: string | null;
  detached_at: Date | null;
}

const columns = `repository, source, phase, seed_step, seed_after, seed_head::text, cursor::text,
  head::text, checked_at, synced_at, error_code, error_at, copied_artifacts::text, copied_bytes::text,
  anchor, detached_at`;
const iso = (value: Date | null) => (value ? value.toISOString() : null);

function decode(row: StateRow): MirrorState {
  return {
    repository: row.repository,
    source: row.source,
    phase: row.phase,
    seedStep: row.seed_step,
    seedAfter: row.seed_after,
    seedHead: row.seed_head,
    cursor: row.cursor,
    head: row.head,
    checkedAt: iso(row.checked_at),
    syncedAt: iso(row.synced_at),
    errorCode: row.error_code,
    errorAt: iso(row.error_at),
    copiedArtifacts: Number(row.copied_artifacts),
    copiedBytes: row.copied_bytes,
    anchor: row.anchor,
    detachedAt: iso(row.detached_at),
  };
}

/** Synchronization state of mirrored repositories (schemas 28 and 37, ADR 0058). */
export class PostgresMirrorState implements MirrorStateStore {
  constructor(private readonly pool: Pool) {}

  async load(repository: string): Promise<MirrorState | null> {
    const result = await this.pool.query<StateRow>(
      `SELECT ${columns} FROM arkvory_mirror_state WHERE repository=$1`,
      [repository],
    );
    const row = result.rows[0];
    return row ? decode(row) : null;
  }

  /** One writer per repository (the worker that owns the storage), so a plain upsert suffices. */
  async save(state: MirrorState): Promise<void> {
    await this.pool.query(
      `INSERT INTO arkvory_mirror_state(repository, source, phase, seed_step, seed_after, seed_head,
         cursor, head, checked_at, synced_at, error_code, error_at, copied_artifacts, copied_bytes,
         anchor, detached_at, updated_at)
       VALUES($1,$2,$3,$4,$5,$6::bigint,$7::bigint,$8::bigint,$9,$10,$11,$12,$13::bigint,$14::bigint,
         $15,$16,now())
       ON CONFLICT (repository) DO UPDATE SET source=excluded.source, phase=excluded.phase,
         seed_step=excluded.seed_step, seed_after=excluded.seed_after, seed_head=excluded.seed_head,
         cursor=excluded.cursor, head=excluded.head, checked_at=excluded.checked_at,
         synced_at=excluded.synced_at, error_code=excluded.error_code, error_at=excluded.error_at,
         copied_artifacts=excluded.copied_artifacts, copied_bytes=excluded.copied_bytes,
         anchor=excluded.anchor, detached_at=excluded.detached_at, updated_at=now()`,
      [
        state.repository,
        state.source,
        state.phase,
        state.seedStep,
        state.seedAfter,
        state.seedHead,
        state.cursor,
        state.head,
        state.checkedAt,
        state.syncedAt,
        state.errorCode,
        state.errorAt,
        String(state.copiedArtifacts),
        state.copiedBytes,
        state.anchor,
        state.detachedAt,
      ],
    );
  }

  /**
   * Marks the mirrors of repositories that are no longer configured as detached (a detach removes
   * the configuration): writes there since belong to this installation, so that state is never
   * followed again. Called by the worker that owns the storage before its mirrors start.
   */
  async reattach(repository: string, synchronizer: string): Promise<boolean> {
    // The mark is written when the worker starts, after the API may already have taken writes,
    // and journal times are transaction starts: neither bounds the changes made here. The
    // journal order does. While mirrored only the synchronizer writes here, so any change of
    // someone else after its first entry was made detached; without such an entry, any change
    // at all counts (a refusal, never a mix). One statement: nothing slips in after the check.
    const cleared = await this.pool.query(
      `UPDATE arkvory_mirror_state s SET detached_at=NULL, updated_at=now()
       WHERE s.repository=$1 AND s.detached_at IS NOT NULL AND NOT EXISTS(
         SELECT 1 FROM arkvory_audit a
         WHERE a.repository=$1 AND a.actor <> $2 AND a.sequence > COALESCE(
           (SELECT min(m.sequence) FROM arkvory_audit m WHERE m.repository=$1 AND m.actor=$2), 0))`,
      [repository, synchronizer],
    );
    return cleared.rowCount === 1;
  }

  async markDetached(configured: readonly string[]): Promise<void> {
    await this.pool.query(
      `UPDATE arkvory_mirror_state SET detached_at=now(), updated_at=now()
       WHERE detached_at IS NULL AND NOT (repository = ANY($1::text[]))`,
      [configured],
    );
  }
}

/**
 * Gives an unfinished upload of the mirror a fresh lifetime: one that expired while the source
 * was unreachable (still pending, or already cancelled by online cleanup), or whose parts did not
 * add up to the source SHA-256. The artifact ID is the source's, so the row is reused instead of
 * recreated. A pending upload keeps its recorded parts, so a copy longer than an upload's
 * lifetime still finishes; cleanup reclaimed the parts of a cancelled one, and `discardParts`
 * drops parts that added up to other bytes. Dropped parts are written again.
 * Only an upload of `owner` that was never published is touched: a copy deleted here stays
 * deleted. The upload lock, which online cleanup holds while it reclaims old parts, keeps both
 * from overlapping; a busy lock is retried by the next step. An upload whose bytes cleanup had
 * already released takes them again only within capacity and quota, as a new upload would.
 */
export async function reopenMirrorUpload(
  pool: Pool,
  repository: string,
  id: string,
  owner: string,
  capacityBytes: number,
  discardParts = false,
): Promise<boolean> {
  const client = await pool.connect();
  let broken = false;
  try {
    await client.query('BEGIN');
    const lock = await client.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_xact_lock($1::bigint) AS acquired',
      [uploadLockKey(id)],
    );
    if (!lock.rows[0]?.acquired) throw new ArkvoryError('busy', 'Upload is being modified');
    const before = (
      await client.query<{ size: string; status: string; reclaimed: boolean }>(
        'SELECT size::text, status, reclaimed FROM arkvory_uploads WHERE repository=$1 AND id=$2',
        [repository, id],
      )
    ).rows[0];
    if (before?.reclaimed) {
      await lockReservations(client);
      await requireRoom(client, repository, Number(before.size), capacityBytes);
    }
    const reopened = await client.query(
      `UPDATE arkvory_uploads SET status='pending', cancelled_at=NULL, reclaimed=false,
         temp_cleaned=false, expires_at=now()+interval '7 days'
       WHERE repository=$1 AND id=$2 AND owner=$3 AND published_at IS NULL
         AND (status='pending' OR (status='cancelled' AND NOT EXISTS(
           SELECT 1 FROM arkvory_artifact_deletions WHERE artifact_id=$2)))
       RETURNING id`,
      [repository, id, owner],
    );
    if (reopened.rowCount === 1 && (discardParts || before?.status !== 'pending'))
      await client.query('DELETE FROM arkvory_parts WHERE upload_id=$1', [id]);
    await client.query('COMMIT');
    return reopened.rowCount === 1;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      broken = true;
    }
    throw error;
  } finally {
    client.release(broken);
  }
}
