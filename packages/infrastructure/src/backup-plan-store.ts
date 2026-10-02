import type { Pool, PoolClient } from 'pg';
import { ArkvoryError, requireId } from '@proanima/arkvory-domain';
import type { BackupPlanUpdate } from '@proanima/arkvory-domain';
import type {
  AgentLease,
  AgentPlan,
  BackupPlanStore,
  StoredBackupPlan,
} from '@proanima/arkvory-application';
import { inTransaction } from './pg-transaction.js';
import { requireAgentLease } from './backup-agent-lease.js';

interface PlanRow {
  enabled: boolean;
  hour: number;
  minute: number;
  timezone: string;
  keep_daily: number;
  keep_weekly: number;
  keep_monthly: number;
  revision: number;
  schedule_from: Date;
  last_slot_at: Date | null;
  updated_by: string | null;
  updated_at: Date;
}
const planColumns = `enabled, hour, minute, timezone, keep_daily, keep_weekly, keep_monthly,
  revision, schedule_from, last_slot_at, updated_by, updated_at`;
/**
 * Requester of work the agent queues itself (schedule and follow-ups). The colon keeps it out of
 * the name space of file key ids, so no caller can reuse the agent's idempotency keys.
 */
export const AGENT_REQUESTER = 'agent:backup';

function plan(row: PlanRow | undefined): StoredBackupPlan {
  // Migration 26 inserts the row; its absence means the schema is not this release's.
  if (!row) throw new ArkvoryError('unavailable', 'Backup plan is missing');
  return {
    enabled: row.enabled,
    hour: row.hour,
    minute: row.minute,
    timezone: row.timezone,
    retention: { daily: row.keep_daily, weekly: row.keep_weekly, monthly: row.keep_monthly },
    revision: row.revision,
    scheduleFrom: row.schedule_from.getTime(),
    lastSlotAt: row.last_slot_at?.getTime() ?? null,
    updatedAt: row.updated_at.getTime(),
    updatedBy: row.updated_by,
  };
}

/** Reads the plan row on a pool or inside the caller's transaction. */
export async function readBackupPlan(client: Pool | PoolClient): Promise<StoredBackupPlan> {
  const result = await client.query<PlanRow>(
    `SELECT ${planColumns} FROM arkvory_backup_plan WHERE singleton`,
  );
  return plan(result.rows[0]);
}

/** The single backup plan row: CAS edits from the API, slot consumption by the agent. */
export class PostgresBackupPlan implements BackupPlanStore, AgentPlan {
  constructor(private readonly pool: Pool) {}

  read(): Promise<StoredBackupPlan> {
    return readBackupPlan(this.pool);
  }

  /**
   * schedule_from moves only when a schedule field changes: earlier slots then never count as
   * missed, while editing retention alone keeps a pending catch-up run.
   */
  async save(update: BackupPlanUpdate, actor: string): Promise<StoredBackupPlan> {
    const { retention } = update;
    const result = await this.pool.query<PlanRow>(
      `UPDATE arkvory_backup_plan SET
        schedule_from=CASE WHEN (enabled, hour, minute, timezone)
          IS DISTINCT FROM ($1::boolean, $2::smallint, $3::smallint, $4::varchar)
          THEN clock_timestamp() ELSE schedule_from END,
        enabled=$1, hour=$2, minute=$3, timezone=$4, keep_daily=$5, keep_weekly=$6,
        keep_monthly=$7, revision=revision+1, updated_by=$8, updated_at=clock_timestamp()
       WHERE singleton AND revision=$9 RETURNING ${planColumns}`,
      [
        update.enabled,
        update.hour,
        update.minute,
        update.timezone,
        retention.daily,
        retention.weekly,
        retention.monthly,
        actor.slice(0, 160),
        update.expectedRevision,
      ],
    );
    if (!result.rows[0])
      throw new ArkvoryError('conflict', 'Backup plan changed', { reason: 'revision_mismatch' });
    return plan(result.rows[0]);
  }

  /**
   * The slot is recorded and its capture queued in one transaction, under the agent lease and
   * the plan revision the decision was made from: a slot runs at most once, a plan disabled or
   * edited meanwhile is decided again.
   */
  async consume(
    lease: AgentLease,
    slot: number,
    request: { readonly id: string; readonly key: string; readonly revision: number },
  ): Promise<boolean> {
    return inTransaction(this.pool, async (client) => {
      await requireAgentLease(client, lease);
      const recorded = await client.query(
        `UPDATE arkvory_backup_plan SET last_slot_at=to_timestamp($1::double precision / 1000)
         WHERE singleton AND enabled AND revision=$2 AND (last_slot_at IS NULL
           OR last_slot_at < to_timestamp($1::double precision / 1000))`,
        [slot, request.revision],
      );
      if (recorded.rowCount !== 1) return false;
      await client.query(
        `INSERT INTO arkvory_backup_requests(id, kind, idempotency_key, requested_by, state)
         VALUES ($1, 'capture', $2, $3, 'queued')
         ON CONFLICT (requested_by, kind, idempotency_key) DO NOTHING`,
        [requireId(request.id), request.key, AGENT_REQUESTER],
      );
      return true;
    });
  }
}
