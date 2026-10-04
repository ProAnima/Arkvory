import type { PoolClient } from 'pg';

/** One page (100 entries) of an account's service audit after `after`, oldest first. */
export async function serviceAuditPage(c: PoolClient, accountId: string, after: string) {
  const rows = await c.query<{
    sequence: string;
    actor: string;
    action: string;
    account_id: string;
    key_id: string | null;
    occurred_at: Date;
  }>(
    'SELECT sequence::text,actor,action,account_id,key_id,occurred_at FROM arkvory_service_audit WHERE account_id=$1 AND sequence>$2::bigint ORDER BY arkvory_service_audit.sequence LIMIT 100',
    [accountId, after],
  );
  return rows.rows.map((r) => ({
    sequence: r.sequence,
    actor: r.actor,
    action: r.action,
    accountId: r.account_id,
    keyId: r.key_id,
    occurredAt: r.occurred_at.toISOString(),
  }));
}
