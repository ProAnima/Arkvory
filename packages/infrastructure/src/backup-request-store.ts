import type { Pool } from 'pg';
import { ArkvoryError, jobViewState, requireId } from '@proanima/arkvory-domain';
import type {
  BackupFailureCode,
  BackupJobState,
  BackupRequestKind,
  BackupRequestState,
  VerifyDepth,
} from '@proanima/arkvory-domain';
import type {
  AgentLease,
  AgentQueue,
  BackupJobLog,
  BackupJobRecord,
  BackupPage,
  BackupPageQuery,
  BackupRequestInput,
  BackupRequestQueue,
  BackupRequestReceipt,
  ClaimedRequest,
  RequestProgress,
} from '@proanima/arkvory-application';
import { inTransaction } from './pg-transaction.js';
import { agentFence, leaseLost, requireAgentLease } from './backup-agent-lease.js';
import { AGENT_REQUESTER } from './backup-plan-store.js';
import { decodeCursor, encodeCursor } from './backup-cursor.js';

/** Open requests a caller may queue before the agent catches up (queue_full beyond). */
export const MAX_OPEN_BACKUP_REQUESTS = 100;

interface JobRow {
  id: string;
  kind: BackupRequestKind;
  request_state: BackupRequestState | null;
  capture_state: BackupJobState | null;
  phase: string | null;
  started_at: Date;
  finished_at: Date | null;
  error_code: string | null;
  point_id: string | null;
  bytes_done: string;
  bytes_total: string;
  blobs_done: string;
  blobs_total: string;
  cursor_at: string;
}

/*
 * The public job view: every request, plus capture jobs nobody requested through the API (the
 * operator CLI). A capture request shows the phase and counters of its capture job.
 */
const jobView = `SELECT * FROM (
    SELECT r.id::text, r.kind, r.state AS request_state, j.state AS capture_state,
      CASE WHEN r.kind='capture' THEN j.phase ELSE r.phase END AS phase,
      COALESCE(r.started_at, r.created_at) AS started_at, r.finished_at, r.error_code,
      r.point_id::text,
      CASE WHEN r.kind='capture' THEN COALESCE(j.bytes_copied, 0) ELSE r.bytes_done END::text
        AS bytes_done,
      CASE WHEN r.kind='capture' THEN COALESCE(j.bytes_total, 0) ELSE r.bytes_total END::text
        AS bytes_total,
      CASE WHEN r.kind='capture' THEN COALESCE(j.blobs_copied, 0) ELSE r.blobs_done END::text
        AS blobs_done,
      CASE WHEN r.kind='capture' THEN COALESCE(j.blobs_total, 0) ELSE r.blobs_total END::text
        AS blobs_total,
      (extract(epoch FROM r.created_at) * 1000000)::bigint::text AS cursor_at
    FROM arkvory_backup_requests r LEFT JOIN arkvory_backup_jobs j ON j.id=r.job_id
    UNION ALL
    SELECT j.id::text, 'capture', NULL, j.state, j.phase, j.created_at,
      CASE WHEN j.state IN ('completed','failed','interrupted') THEN j.updated_at END,
      j.error_code, CASE WHEN j.state='completed' THEN j.point_id::text END,
      j.bytes_copied::text, j.bytes_total::text, j.blobs_copied::text, j.blobs_total::text,
      (extract(epoch FROM j.created_at) * 1000000)::bigint::text
    FROM arkvory_backup_jobs j
    WHERE NOT EXISTS (SELECT 1 FROM arkvory_backup_requests r WHERE r.job_id=j.id)
  ) jobs`;

export function jobRecord(row: JobRow): BackupJobRecord {
  return {
    id: row.id,
    kind: row.kind,
    state: jobViewState(row.request_state, row.capture_state),
    phase: row.phase,
    startedAt: row.started_at.getTime(),
    finishedAt: row.finished_at?.getTime() ?? null,
    errorCode: row.error_code,
    pointId: row.point_id,
    progress: {
      bytesCopied: row.bytes_done,
      bytesTotal: row.bytes_total,
      blobsCopied: Number(row.blobs_done),
      blobsTotal: Number(row.blobs_total),
    },
  };
}

/** The job currently executing, if any: one agent runs one request at a time. */
export const runningJobQuery = `${jobView}
  WHERE request_state='running' OR (request_state IS NULL AND capture_state IN
    ('running','committing'))
  ORDER BY cursor_at::bigint DESC, id DESC LIMIT 1`;

/** Requests of the API and the agent queue (ADR 0056), idempotent per requester and key. */
export class PostgresBackupRequests implements BackupRequestQueue, BackupJobLog, AgentQueue {
  constructor(private readonly pool: Pool) {}

  async enqueue(request: BackupRequestInput): Promise<BackupRequestReceipt> {
    const inserted = await this.pool.query<{ id: string }>(
      `INSERT INTO arkvory_backup_requests(id, kind, point_id, depth, idempotency_key,
         requested_by, request_id, state)
       SELECT $1, $2, $3, $4, $5, $6, $7, 'queued'
       WHERE (SELECT count(*) FROM arkvory_backup_requests WHERE state IN ('queued','running'))<$8
       ON CONFLICT (requested_by, kind, idempotency_key) DO NOTHING RETURNING id::text`,
      [
        requireId(request.id),
        request.kind,
        request.pointId,
        request.depth,
        request.idempotencyKey,
        request.requestedBy.slice(0, 160),
        request.requestId?.slice(0, 128) ?? null,
        MAX_OPEN_BACKUP_REQUESTS,
      ],
    );
    if (inserted.rows[0]) return { id: request.id, kind: request.kind, state: 'queued' };
    const existing = await this.pool.query<{
      id: string;
      point_id: string | null;
      state: BackupRequestState;
      capture_state: BackupJobState | null;
    }>(
      `SELECT r.id::text, r.point_id::text, r.state, j.state AS capture_state
       FROM arkvory_backup_requests r LEFT JOIN arkvory_backup_jobs j ON j.id=r.job_id
       WHERE r.requested_by=$1 AND r.kind=$2 AND r.idempotency_key=$3`,
      [request.requestedBy.slice(0, 160), request.kind, request.idempotencyKey],
    );
    const row = existing.rows[0];
    if (!row)
      throw new ArkvoryError('capacity_exceeded', 'Too many backup requests are waiting', {
        reason: 'queue_full',
      });
    // A capture records its resulting point; only a verification names its target up front.
    if (request.kind === 'verify' && row.point_id !== request.pointId)
      throw new ArkvoryError('conflict', 'Idempotency key was used for another point', {
        reason: 'idempotency_mismatch',
      });
    return { id: row.id, kind: request.kind, state: jobViewState(row.state, row.capture_state) };
  }

  async jobs(query: BackupPageQuery): Promise<BackupPage<BackupJobRecord>> {
    const cursor = query.after === undefined ? null : decodeCursor(query.after);
    const result = await this.pool.query<JobRow>(
      `${jobView} WHERE $1::bigint IS NULL OR (cursor_at::bigint, id::uuid) < ($1, $2::uuid)
       ORDER BY cursor_at::bigint DESC, id::uuid DESC LIMIT $3`,
      [cursor?.at ?? null, cursor?.id ?? null, query.limit + 1],
    );
    const rows = result.rows.slice(0, query.limit);
    const last = rows.at(-1);
    return {
      items: rows.map(jobRecord),
      next: result.rows.length > query.limit && last ? encodeCursor(last.cursor_at, last.id) : null,
    };
  }

  async claim(lease: AgentLease): Promise<ClaimedRequest | null> {
    return inTransaction(this.pool, async (client) => {
      await requireAgentLease(client, lease);
      // A running request of an earlier generation lost its agent; it runs again here.
      const claimed = await client.query<{
        id: string;
        kind: BackupRequestKind;
        point_id: string | null;
        depth: VerifyDepth | null;
        attempts: number;
      }>(
        `UPDATE arkvory_backup_requests SET state='running', attempts=attempts+1,
          agent_generation=$1, started_at=COALESCE(started_at, clock_timestamp())
         WHERE id=(SELECT id FROM arkvory_backup_requests
           WHERE state='queued' OR (state='running' AND agent_generation<$1)
           ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED)
         RETURNING id::text, kind, point_id::text, depth, attempts`,
        [lease.generation],
      );
      const row = claimed.rows[0];
      if (!row) return null;
      return {
        id: row.id,
        kind: row.kind,
        pointId: row.point_id,
        depth: row.depth,
        attempts: row.attempts,
      };
    });
  }

  /** Writes to the running request of this lease; anything else means the lease was lost. */
  private async running(lease: AgentLease, id: string, set: string, values: unknown[]) {
    lease.throwIfAborted();
    const result = await this.pool.query(
      `UPDATE arkvory_backup_requests SET ${set}
       WHERE id=$1 AND state='running' AND agent_generation=$3 AND ${agentFence(2, 3)}`,
      [id, lease.owner, lease.generation, ...values],
    );
    if (result.rowCount !== 1) throw leaseLost();
  }

  attach(lease: AgentLease, id: string, jobId: string): Promise<void> {
    return this.running(lease, id, 'job_id=$4', [requireId(jobId)]);
  }

  progress(lease: AgentLease, id: string, progress: RequestProgress): Promise<void> {
    return this.running(
      lease,
      id,
      'phase=$4, bytes_done=$5, bytes_total=$6, blobs_done=$7, blobs_total=$8',
      [
        progress.phase.slice(0, 32),
        progress.bytesDone.toString(),
        progress.bytesTotal.toString(),
        progress.blobsDone,
        progress.blobsTotal,
      ],
    );
  }

  finish(
    lease: AgentLease,
    id: string,
    outcome: { readonly failed: BackupFailureCode | null; readonly pointId: string | null },
  ): Promise<void> {
    return this.running(
      lease,
      id,
      `state=$4, error_code=$5, point_id=COALESCE($6::uuid, point_id),
        finished_at=clock_timestamp()`,
      [outcome.failed ? 'failed' : 'done', outcome.failed, outcome.pointId],
    );
  }

  requeue(lease: AgentLease, id: string): Promise<void> {
    return this.running(lease, id, "state='queued', agent_generation=NULL", []);
  }

  async followUp(
    lease: AgentLease,
    request: {
      readonly id: string;
      readonly kind: BackupRequestKind;
      readonly pointId: string | null;
      readonly depth: VerifyDepth | null;
      readonly key: string;
    },
  ): Promise<boolean> {
    lease.throwIfAborted();
    const inserted = await this.pool.query(
      `INSERT INTO arkvory_backup_requests(id, kind, point_id, depth, idempotency_key,
         requested_by, state)
       SELECT $3, $4, $5, $6, $7, $8, 'queued' WHERE ${agentFence(1, 2)}
       ON CONFLICT (requested_by, kind, idempotency_key) DO NOTHING`,
      [
        lease.owner,
        lease.generation,
        requireId(request.id),
        request.kind,
        request.pointId,
        request.depth,
        request.key,
        AGENT_REQUESTER,
      ],
    );
    return inserted.rowCount === 1;
  }
}
