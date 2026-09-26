import type { Pool } from 'pg';
import { ArkvoryError, requireId } from '@proanima/arkvory-domain';
import { StorageOwnership } from './storage-ownership.js';

export type StorageRole = 'api' | 'reader' | 'worker' | 'maintenance';

/** Acquire the established profile, writer, maintenance and content-pin barriers in order. */
export async function claimStorageSession(
  pool: Pool,
  storageId: string,
  role: StorageRole,
  sharedDownloads: boolean,
): Promise<StorageOwnership> {
  const client = await pool.connect();
  const ownership = new StorageOwnership(client);
  try {
    if (role === 'reader' && !sharedDownloads)
      throw new ArkvoryError('invalid_input', 'Reader requires shared download policy');
    if (role === 'api' || role === 'reader') {
      const mode = await client.query<{ acquired: boolean }>(
        sharedDownloads
          ? 'SELECT pg_try_advisory_lock_shared(18471,7) AS acquired'
          : 'SELECT pg_try_advisory_lock(18471,7) AS acquired',
      );
      if (!mode.rows[0]?.acquired)
        throw new ArkvoryError('busy', 'Conflicting gateway profile is active');
      if (!sharedDownloads) {
        const policy = await client.query('SELECT 1 FROM arkvory_download_policy');
        if (policy.rowCount)
          throw new ArkvoryError('conflict', 'Database requires shared download configuration');
      }
    }
    // One writer per database, including the shared-download profile. This is not HA.
    if (role === 'worker') {
      const worker = await client.query<{ acquired: boolean }>(
        'SELECT pg_try_advisory_lock(18471,6) AS acquired',
      );
      if (!worker.rows[0]?.acquired)
        throw new ArkvoryError('busy', 'Standalone supports one completion worker');
    }
    if (role !== 'worker' && role !== 'reader') {
      const lock = await client.query<{ acquired: boolean }>(
        'SELECT pg_try_advisory_lock(18471,3) AS acquired',
      );
      if (!lock.rows[0]?.acquired)
        throw new ArkvoryError('busy', 'Another writer or maintenance process owns this database');
    }
    const barrier = await client.query<{ acquired: boolean }>(
      role === 'maintenance'
        ? 'SELECT pg_try_advisory_lock(18471,4) AS acquired'
        : 'SELECT pg_try_advisory_lock_shared(18471,4) AS acquired',
    );
    if (!barrier.rows[0]?.acquired)
      throw new ArkvoryError('busy', 'Maintenance requires all gateways and workers to be stopped');
    if (role === 'reader') {
      const legacy = await client.query(`SELECT 1 FROM pg_locks writer
          WHERE writer.locktype='advisory' AND writer.classid=18471 AND writer.objid=3 AND writer.objsubid=2 AND writer.granted
          AND writer.database=(SELECT oid FROM pg_database WHERE datname=current_database())
          AND NOT EXISTS(SELECT 1 FROM pg_locks mode WHERE mode.pid=writer.pid AND mode.locktype='advisory'
            AND mode.classid=18471 AND mode.objid=7 AND mode.objsubid=2 AND mode.granted)`);
      if (legacy.rowCount)
        throw new ArkvoryError('busy', 'Upgrade the writer before starting read gateways');
    }
    if (role !== 'reader')
      await client.query(
        'INSERT INTO arkvory_storage_identity(singleton,storage_id) VALUES(true,$1) ON CONFLICT DO NOTHING',
        [requireId(storageId)],
      );
    const identity = await client.query<{ storage_id: string }>(
      'SELECT storage_id,pg_advisory_lock_shared(18471,17) FROM arkvory_storage_identity WHERE singleton=true',
    );
    if (identity.rows[0]?.storage_id !== storageId)
      throw new ArkvoryError('conflict', 'Database belongs to a different storage directory');

    await ownership.start(
      role === 'worker'
        ? [6, 4, 17]
        : role === 'reader'
          ? [7, 4, 17]
          : role === 'api'
            ? [7, 3, 4, 17]
            : [3, 4, 17],
    );
    return ownership;
  } catch (error) {
    await ownership.close();
    throw error;
  }
}
