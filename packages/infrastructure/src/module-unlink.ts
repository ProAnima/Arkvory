import type { Pool } from 'pg';
import { ArkvoryError } from '@proanima/arkvory-domain';
import { StorageOwnership } from './storage-ownership.js';

/** Global conservative admission: no active content reader, no backup pin of ANY upload. */
export class ModuleUnlinkAdmission {
  constructor(private readonly pool: Pool) {}
  async run<T>(work: (check: () => void) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const ownership = new StorageOwnership(client);
    try {
      await ownership.startConnection();
      for (const query of [
        'SELECT pg_try_advisory_lock(18471,23) AS acquired',
        'SELECT pg_try_advisory_lock_shared(18471,18) AS acquired',
      ]) {
        const result = await client.query<{ acquired: boolean }>(query);
        if (!result.rows[0]?.acquired) throw new ArkvoryError('busy', 'Module data is pinned');
      }
      const state = await client.query<{ open: boolean; pinned: boolean }>(
        `SELECT state='open' AS open, EXISTS(SELECT 1 FROM arkvory_backup_pins) AS pinned
         FROM arkvory_backup_barrier WHERE singleton`,
      );
      if (!state.rows[0]?.open || state.rows[0].pinned)
        throw new ArkvoryError('busy', 'Module data is pinned');
      const check = () => {
        if (!ownership.active)
          throw new ArkvoryError('unavailable', 'Module cleanup protection lost');
      };
      check();
      return await work(check);
    } finally {
      // Never return a session holding a global lock to the pool, including on cancellation.
      await ownership.close();
    }
  }
}
