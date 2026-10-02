import type { PoolClient } from 'pg';
import type { RestoreNormalization } from '@proanima/arkvory-application';

/** Version of the transformation below; recorded in the security journal of the target. */
export const RESTORE_NORMALIZATION_VERSION = 1;

/**
 * Normalization 1 for schema 25, run inside the load transaction (ADR 0054). A restored
 * instance continues nothing that was in flight at T and activates no credential by itself:
 *  - pending uploads are cancelled; their parts and staging are not part of a point;
 *  - only published content is restored, so every other row holds no bytes and no quota;
 *  - queued/running completion jobs fail with the permanent code `conflict`;
 *  - unfinished promotion copies are dropped (their target upload is cancelled above);
 *  - personal tokens are revoked and service keys become `revoked`: credentials are re-issued;
 *  - cleanup and retention policies are disabled until an operator enables them again;
 *  - sessions, gateway leases, the download topology and backup state were never exported.
 */
export async function normalizeRestore(
  client: PoolClient,
  input: { readonly pointId: string; readonly storageId: string; readonly restoredAt: string },
): Promise<RestoreNormalization> {
  const at = input.restoredAt;
  const count = async (sql: string, values: unknown[] = []) =>
    (await client.query(sql, values)).rowCount ?? 0;
  const cancelledUploads = await count(
    `UPDATE arkvory_uploads SET status='cancelled', cancelled_at=COALESCE(cancelled_at,$1)
     WHERE status='pending'`,
    [at],
  );
  await client.query(
    `UPDATE arkvory_uploads SET temp_cleaned=true, reclaimed=(status<>'available'),
      gc_checked_at=$1`,
    [at],
  );
  await client.query(`DELETE FROM arkvory_parts p USING arkvory_uploads u
    WHERE p.upload_id=u.id AND u.status<>'available'`);
  const failedJobs = await count(
    `UPDATE arkvory_jobs SET status='failed', error_code='conflict', lease_until=NULL
     WHERE status IN ('queued','running')`,
  );
  const droppedPromotions = await count(`DELETE FROM arkvory_promotions WHERE state='pending'`);
  const revokedTokens = await count(
    'UPDATE arkvory_user_tokens SET revoked_at=$1 WHERE revoked_at IS NULL',
    [at],
  );
  const revokedServiceKeys = await count(
    `UPDATE arkvory_api_keys SET state='revoked' WHERE state<>'revoked'`,
  );
  let disabledPolicies = 0;
  for (const table of ['arkvory_cleanup_settings', 'arkvory_storage_policies'])
    disabledPolicies += await count(
      `UPDATE ${table} SET policy=jsonb_set(policy,'{enabled}','false'::jsonb),
        revision=revision+1 WHERE policy->>'enabled'='true'`,
    );
  await client.query(
    'INSERT INTO arkvory_storage_identity(singleton, storage_id) VALUES(true, $1)',
    [input.storageId],
  );
  const result = {
    cancelledUploads,
    failedJobs,
    droppedPromotions,
    revokedTokens,
    revokedServiceKeys,
    disabledPolicies,
  };
  await client.query(
    `INSERT INTO arkvory_security_audit(actor, action, target, outcome, details)
     VALUES('backup-restore', 'backup.restored', $1, 'success', $2::jsonb)`,
    [input.pointId, JSON.stringify({ normalization: RESTORE_NORMALIZATION_VERSION, ...result })],
  );
  return result;
}
