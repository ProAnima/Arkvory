import type { Pool } from 'pg';
import { BackupFailure } from '@proanima/arkvory-domain';
import type { Cancellation, VaultLock } from '@proanima/arkvory-application';
import { StorageOwnership } from './storage-ownership.js';

/** Advisory key of the vault maintenance lock in the source database (ADR 0056). */
export const VAULT_LOCK = 21;

/**
 * Vault maintenance lock 18471/21 on a dedicated session. Captures (CLI and agent, inside
 * claimBackupSource) and verifications hold it shared; retention holds it exclusively, so
 * prune never deletes content that a capture has just decided to reuse or that a verification
 * reads. Both sides only try the lock and refuse with `busy`: nobody waits, no lock cycle can
 * form. The session lock ends with its connection, so a crashed holder never strands it and
 * no lock is ever broken by age.
 */
export class PostgresVaultLock implements VaultLock {
  constructor(private readonly pool: Pool) {}

  shared<T>(action: (held: Cancellation) => Promise<T>): Promise<T> {
    return this.hold(true, action);
  }

  exclusive<T>(action: (held: Cancellation) => Promise<T>): Promise<T> {
    return this.hold(false, action);
  }

  private async hold<T>(shared: boolean, action: (held: Cancellation) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const ownership = new StorageOwnership(client);
    try {
      const acquired = await client.query<{ acquired: boolean }>(
        `SELECT pg_try_advisory_lock${shared ? '_shared' : ''}(18471, ${String(VAULT_LOCK)})
         AS acquired`,
      );
      if (acquired.rows[0]?.acquired !== true)
        throw new BackupFailure('busy', 'The backup vault is being captured or maintained');
      await ownership.start([VAULT_LOCK]);
      return await action({
        throwIfAborted() {
          if (!ownership.active)
            throw new BackupFailure('lease_lost', 'The vault lock session was lost');
        },
      });
    } finally {
      // Destroying the session releases the advisory lock on every path.
      await ownership.close();
    }
  }
}
