import type { Pool, PoolClient } from 'pg';
import { ArkvoryError } from '@proanima/arkvory-domain';
import type { AccountOrigin, SecurityEvent } from '@proanima/arkvory-application';
import { inTransaction } from './pg-transaction.js';

export function conflict(error: unknown): never {
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505')
    throw new ArkvoryError('conflict', 'Account or group already exists', {
      reason: 'already_exists',
    });
  throw error;
}
// Self-registration stops early so anonymous sign-ups cannot exhaust administrator capacity.
export const accountCapacity: Record<AccountOrigin, number> = {
  administrator: 1000,
  'self-registration': 900,
};
export const success = (
  action: SecurityEvent['action'],
  target: string,
  details?: SecurityEvent['details'],
): SecurityEvent => ({ action, target, outcome: 'success', ...(details ? { details } : {}) });

/** Account and group changes serialize on one lock, so capacity checks see every insert. */
export function capacityMutation<T>(
  pool: Pool,
  action: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return inTransaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(18471,10)');
    return action(client);
  });
}
