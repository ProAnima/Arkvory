import type { Pool, PoolClient } from 'pg';
import type {
  BackupAgentRecord,
  BackupStatusSnapshot,
  BackupStatusSource,
} from '@proanima/arkvory-application';
import { readBackupPlan } from './backup-plan-store.js';
import { pointColumns, pointRecord } from './backup-catalog.js';
import { jobRecord, runningJobQuery } from './backup-request-store.js';

interface AgentRow {
  now: Date;
  owner: string | null;
  heartbeat_at: Date | null;
  version: string | null;
  vault_configured: boolean;
  vault_id: string | null;
  vault_available: boolean;
  vault_free_bytes: string | null;
  vault_total_bytes: string | null;
  last_error: string | null;
  vault_encrypted: boolean | null;
}

function agentRecord(row: AgentRow | undefined): BackupAgentRecord | null {
  if (!row?.heartbeat_at) return null;
  return {
    // A released lease means the agent stopped; its last heartbeat stays the last seen time.
    active: row.owner !== null,
    seenAt: row.heartbeat_at.getTime(),
    version: row.version,
    vaultConfigured: row.vault_configured,
    vaultId: row.vault_id,
    vaultAvailable: row.vault_available,
    freeBytes: row.vault_free_bytes,
    totalBytes: row.vault_total_bytes,
    lastError: row.last_error,
    vaultEncrypted: row.vault_encrypted,
  };
}

/**
 * Status of unattended backups from the database alone: the API never touches the vault. One
 * read-only snapshot keeps heartbeat, plan, catalog and jobs consistent with each other.
 */
export class PostgresBackupStatus implements BackupStatusSource {
  constructor(private readonly pool: Pool) {}

  async currentVault(): Promise<string | null> {
    const result = await this.pool.query<{ vault_id: string | null }>(
      'SELECT vault_id::text FROM arkvory_backup_agent WHERE singleton',
    );
    return result.rows[0]?.vault_id ?? null;
  }

  async snapshot(): Promise<BackupStatusSnapshot> {
    const client = await this.pool.connect();
    let healthy = false;
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const snapshot = await this.read(client);
      await client.query('COMMIT');
      healthy = true;
      return snapshot;
    } finally {
      if (!healthy) await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  }

  private async read(client: PoolClient): Promise<BackupStatusSnapshot> {
    const agentRow = (
      await client.query<AgentRow>(
        `SELECT now() AS now, a.owner::text, a.heartbeat_at, a.version,
          COALESCE(a.vault_configured, false) AS vault_configured, a.vault_id::text,
          COALESCE(a.vault_available, false) AS vault_available,
          a.vault_free_bytes::text, a.vault_total_bytes::text, a.last_error,
          a.vault_encrypted
         FROM (SELECT 1) one LEFT JOIN arkvory_backup_agent a ON a.singleton`,
      )
    ).rows[0];
    const plan = await readBackupPlan(client);
    const vaultId = agentRow?.vault_id ?? null;
    const points = await client.query<
      Parameters<typeof pointRecord>[0] & {
        verify_failed: boolean;
        last_deep: Date | null;
      }
    >(
      `SELECT ${pointColumns},
         EXISTS (SELECT 1 FROM arkvory_backup_points f WHERE f.vault_id=$1
           AND f.forgotten_at IS NULL AND f.verify_error IS NOT NULL) AS verify_failed,
         (SELECT max(d.deep_verified_at) FROM arkvory_backup_points d WHERE d.vault_id=$1
           AND d.forgotten_at IS NULL) AS last_deep
       FROM arkvory_backup_points WHERE vault_id=$1 AND forgotten_at IS NULL
       ORDER BY snapshot_at DESC, id DESC LIMIT 1`,
      [vaultId],
    );
    const running = (await client.query<Parameters<typeof jobRecord>[0]>(runningJobQuery)).rows[0];
    const failed = await client.query<{ failed: boolean }>(
      `SELECT state='failed' AS failed FROM (
         SELECT r.state, r.finished_at AS at FROM arkvory_backup_requests r
           WHERE r.kind='capture' AND r.state IN ('done','failed')
         UNION ALL
         SELECT CASE j.state WHEN 'completed' THEN 'done' ELSE 'failed' END, j.updated_at
           FROM arkvory_backup_jobs j WHERE j.state IN ('completed','failed')
           AND COALESCE(j.error_code, '')<>'interrupted'
           AND NOT EXISTS (SELECT 1 FROM arkvory_backup_requests r WHERE r.job_id=j.id)
       ) finished ORDER BY at DESC LIMIT 1`,
    );
    const newest = points.rows[0];
    return {
      now: (agentRow?.now ?? new Date(0)).getTime(),
      agent: agentRecord(agentRow),
      plan,
      newest: newest ? pointRecord(newest) : null,
      running: running ? jobRecord(running) : null,
      lastCaptureFailed: failed.rows[0]?.failed === true,
      verifyFailed: newest?.verify_failed === true,
      lastDeepVerifiedAt: newest?.last_deep?.getTime() ?? null,
    };
  }
}
