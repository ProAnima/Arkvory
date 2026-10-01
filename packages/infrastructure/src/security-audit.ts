import type { Pool, PoolClient } from 'pg';
import { credentialKinds } from '@proanima/arkvory-domain';
import type {
  SecurityActor,
  SecurityAuditEntry,
  SecurityAuditLog,
  SecurityAuditPage,
  SecurityAuditReader,
  SecurityDetails,
  SecurityEvent,
} from '@proanima/arkvory-application';
import { inTransaction } from './pg-transaction.js';
import { storedCorrelation } from './request-correlation.js';

interface AuditRow {
  id: string;
  occurred_at: Date;
  actor: string | null;
  credential: string | null;
  action: string;
  target: string | null;
  outcome: string;
  code: string | null;
  client_ip: string | null;
  details: unknown;
}
/** Bounded growth: anonymous failures are audited, so the journal must not grow without limit. */
export const SECURITY_AUDIT_RETENTION = { maxAgeDays: 365, maxRows: 1_000_000, batch: 5000 };

function clip(value: string | null, length: number): string | null {
  return value === null ? null : value.slice(0, length);
}
function insertion(actor: SecurityActor, event: SecurityEvent): [string, unknown[]] {
  return [
    `INSERT INTO arkvory_security_audit(actor,credential,action,target,outcome,code,client_ip,details,request_id)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      clip(actor.id, 160),
      actor.credential,
      event.action,
      clip(event.target, 160),
      event.outcome,
      event.code ?? null,
      clip(actor.clientIp, 64),
      JSON.stringify(event.details ?? {}),
      storedCorrelation(actor.requestId),
    ],
  ];
}
/** Caller owns the transaction: the row commits or rolls back with the audited change. */
export async function appendSecurityEvent(
  client: PoolClient,
  actor: SecurityActor,
  event: SecurityEvent,
): Promise<void> {
  const [sql, values] = insertion(actor, event);
  await client.query(sql, values);
}

function details(value: unknown): SecurityDetails {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const result: Record<string, string | number | boolean | null> = {};
  const entries: readonly (readonly [string, unknown])[] = Object.entries(value);
  for (const [key, item] of entries)
    if (
      item === null ||
      typeof item === 'string' ||
      typeof item === 'number' ||
      typeof item === 'boolean'
    )
      result[key] = item;
  return result;
}
function entry(row: AuditRow): SecurityAuditEntry {
  const outcome = row.outcome === 'failure' || row.outcome === 'denied' ? row.outcome : 'success';
  return {
    id: row.id,
    occurredAt: row.occurred_at.toISOString(),
    actor: row.actor,
    credential: credentialKinds.find((kind) => kind === row.credential) ?? null,
    clientIp: row.client_ip,
    action: row.action,
    target: row.target,
    outcome,
    code: row.code,
    details: details(row.details),
  };
}

export class PostgresSecurityAudit implements SecurityAuditLog, SecurityAuditReader {
  constructor(private readonly pool: Pool) {}

  async append(actor: SecurityActor, event: SecurityEvent): Promise<void> {
    const [sql, values] = insertion(actor, event);
    await this.pool.query(sql, values);
  }

  async list(after: string | undefined, limit: number): Promise<SecurityAuditPage> {
    const result = await this.pool.query<AuditRow>(
      `SELECT id::text AS id,occurred_at,actor,credential,action,target,outcome,code,client_ip,details
       FROM arkvory_security_audit WHERE ($1::bigint IS NULL OR id<$1::bigint)
       ORDER BY id DESC LIMIT $2`,
      [after ?? null, limit + 1],
    );
    const rows = result.rows.slice(0, limit);
    const last = rows.at(-1);
    return {
      items: rows.map(entry),
      next: result.rows.length > limit && last ? last.id : null,
    };
  }

  /** One bounded batch. The append-only trigger admits DELETE only under this local flag. */
  prune(policy = SECURITY_AUDIT_RETENTION): Promise<number> {
    return inTransaction(this.pool, async (client) => {
      await client.query("SELECT set_config('arkvory.security_audit_retention','on',true)");
      const result = await client.query(
        `DELETE FROM arkvory_security_audit WHERE id IN (
           SELECT id FROM arkvory_security_audit
           WHERE occurred_at < now() - make_interval(days => $1)
              OR id <= (SELECT max(id) FROM arkvory_security_audit) - $2
           ORDER BY id LIMIT $3)`,
        [policy.maxAgeDays, policy.maxRows, policy.batch],
      );
      return result.rowCount ?? 0;
    });
  }
}
