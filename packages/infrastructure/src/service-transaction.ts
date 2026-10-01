import type { Pool, PoolClient } from 'pg';
import { ArkvoryError } from '@proanima/arkvory-domain';

/**
 * Service administration transaction. Every control mutation (accounts, keys, delegations)
 * serializes on advisory xact lock 18471/12; reads use one REPEATABLE READ READ ONLY snapshot.
 * Unique violations become `conflict`. A failed ROLLBACK discards the connection.
 */
export async function serviceTransaction<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
  mutation = true,
): Promise<T> {
  const client = await pool.connect();
  let broken = false;
  try {
    await client.query(mutation ? 'BEGIN' : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    if (mutation) await client.query('SELECT pg_advisory_xact_lock(18471,12)');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      broken = true;
    }
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505')
      throw new ArkvoryError('conflict', 'Service name or credential already exists');
    throw error;
  } finally {
    client.release(broken);
  }
}

/** Must run inside the mutation transaction so the event commits or rolls back with the change. */
export async function recordServiceEvent(
  client: PoolClient,
  actor: string,
  action: string,
  accountId: string,
  keyId?: string,
): Promise<void> {
  await client.query(
    'INSERT INTO arkvory_service_audit(actor,action,account_id,key_id) VALUES($1,$2,$3,$4)',
    [actor, action, accountId, keyId ?? null],
  );
  // Bounded operational history; export before retention removes older events.
  await client.query(`DELETE FROM arkvory_service_audit WHERE sequence IN
      (SELECT sequence FROM arkvory_service_audit ORDER BY sequence DESC OFFSET 100000 LIMIT 1000)`);
}
