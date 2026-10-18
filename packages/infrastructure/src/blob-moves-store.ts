import type { Pool, PoolClient } from 'pg';
import { BLOB_MOVE_STATES, MAX_MOVE_ATTEMPTS, isActiveMove } from '@proanima/arkvory-domain';
import type { BlobMoveState } from '@proanima/arkvory-domain';
import type { BlobMoveStore, ClaimedMove, MovePlan } from '@proanima/arkvory-application';

/** How long a claimed move is held without a heartbeat; a copy renews it every third of it. */
export const MOVE_LEASE_SECONDS = 60;

/**
 * Version 45 (ADR 0083, N2), expand-only: moves of published blobs between storages. One
 * active move per upload (partial unique index); `generation` fences every write of the worker
 * that holds the lease. Not part of a backup: a move is a property of the source's storages.
 */
export async function migrateBlobMoves(client: PoolClient): Promise<void> {
  if ((await client.query('SELECT version FROM arkvory_migrations WHERE version=45')).rowCount)
    return;
  await client.query(`
    CREATE TABLE IF NOT EXISTS arkvory_blob_moves (
      id uuid PRIMARY KEY,
      upload_id uuid NOT NULL,
      from_backend varchar(64) NOT NULL,
      to_backend varchar(64) NOT NULL,
      state varchar(16) NOT NULL CHECK (state IN (${BLOB_MOVE_STATES.map((s) => `'${s}'`).join(',')})),
      generation bigint NOT NULL DEFAULT 0,
      lease_until timestamptz,
      attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      error_code varchar(64),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CHECK (from_backend <> to_backend)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS arkvory_blob_moves_active ON arkvory_blob_moves(upload_id)
      WHERE state IN ('planned','copied','switched');
    CREATE INDEX IF NOT EXISTS arkvory_blob_moves_due ON arkvory_blob_moves(lease_until, created_at)
      WHERE state IN ('planned','copied','switched');
    INSERT INTO arkvory_migrations(version) VALUES(45);
  `);
}

interface MoveRow {
  id: string;
  upload_id: string;
  from_backend: string;
  to_backend: string;
  state: string;
  generation: string;
}

function claimed(row: MoveRow): ClaimedMove {
  const state = BLOB_MOVE_STATES.find((known) => known === row.state);
  if (state === undefined || !isActiveMove(state)) throw new Error('Invalid move state');
  const generation = Number(row.generation);
  if (!Number.isSafeInteger(generation)) throw new Error('Invalid move generation');
  return {
    id: row.id,
    uploadId: row.upload_id,
    from: row.from_backend,
    to: row.to_backend,
    state,
    generation,
  };
}

/** `arkvory_blob_moves` on PostgreSQL; claims skip rows another worker is claiming. */
export class PostgresBlobMoves implements BlobMoveStore {
  constructor(private readonly pool: Pool) {}

  async plan(plan: MovePlan): Promise<number> {
    const result = await this.pool.query(
      `INSERT INTO arkvory_blob_moves(id, upload_id, from_backend, to_backend, state)
       SELECT gen_random_uuid(), u.id, $1::varchar, $2::varchar, 'planned' FROM arkvory_uploads u
       WHERE u.status='available' AND u.storage_backend=$1 AND ($3::text IS NULL OR u.repository=$3)
         AND NOT EXISTS (SELECT 1 FROM arkvory_blob_moves m WHERE m.upload_id=u.id
           AND m.state IN ('planned','copied','switched'))
       ORDER BY u.id LIMIT $4
       ON CONFLICT DO NOTHING`,
      [plan.from, plan.to, plan.repository, plan.limit],
    );
    return result.rowCount ?? 0;
  }

  async counts(): Promise<Readonly<Partial<Record<BlobMoveState, number>>>> {
    const result = await this.pool.query<{ state: string; count: number }>(
      'SELECT state, count(*)::integer AS count FROM arkvory_blob_moves GROUP BY state',
    );
    const counts: Partial<Record<BlobMoveState, number>> = {};
    for (const row of result.rows) {
      const state = BLOB_MOVE_STATES.find((known) => known === row.state);
      if (state) counts[state] = row.count;
    }
    return counts;
  }

  async claim(limit: number): Promise<readonly ClaimedMove[]> {
    const result = await this.pool.query<MoveRow>(
      `UPDATE arkvory_blob_moves SET generation=generation+1,
         lease_until=now()+make_interval(secs=>$2::integer), updated_at=now()
       WHERE id IN (SELECT id FROM arkvory_blob_moves
         WHERE state IN ('planned','copied','switched') AND (lease_until IS NULL OR lease_until<now())
         ORDER BY created_at, id LIMIT $1 FOR UPDATE SKIP LOCKED)
       RETURNING id, upload_id, from_backend, to_backend, state, generation::text`,
      [limit, MOVE_LEASE_SECONDS],
    );
    return result.rows.map(claimed);
  }

  private async fenced(move: ClaimedMove, set: string, values: readonly unknown[]) {
    const result = await this.pool.query(
      `UPDATE arkvory_blob_moves SET ${set}, updated_at=now()
       WHERE id=$1 AND generation=$2 AND state=$3`,
      [move.id, move.generation, move.state, ...values],
    );
    return result.rowCount === 1;
  }

  /** The next state keeps the lease: the same worker continues with the next step. */
  advance(move: ClaimedMove, state: BlobMoveState): Promise<boolean> {
    return this.fenced(move, 'state=$4, error_code=NULL', [state]);
  }

  defer(move: ClaimedMove): Promise<boolean> {
    return this.fenced(move, 'lease_until=now()+make_interval(secs=>$4::integer)', [5]);
  }

  fail(move: ClaimedMove, code: string, final: boolean): Promise<boolean> {
    return this.fenced(
      move,
      `attempts=attempts+1, error_code=$4,
       state=CASE WHEN $5::boolean OR attempts+1 >= $6::integer THEN 'failed' ELSE state END,
       lease_until=now()+make_interval(secs=>least(300, 5 * power(2, attempts)::integer))`,
      [code.slice(0, 64), final, MAX_MOVE_ATTEMPTS],
    );
  }

  heartbeat(move: ClaimedMove): Promise<boolean> {
    return this.fenced(move, 'lease_until=now()+make_interval(secs=>$4::integer)', [
      MOVE_LEASE_SECONDS,
    ]);
  }
}
