import { Pool } from 'pg';
import { BackupFailure } from '@proanima/arkvory-domain';
import type { InventoryEntry } from '@proanima/arkvory-domain';
import type { ContentSource } from '@proanima/arkvory-application';
import { StorageOwnership } from './storage-ownership.js';
import { hasCode } from './fs-durability.js';
import type { LocalBlobStore } from './local-blobs.js';

export type BackupPool = Pool;

/**
 * Pool of a backup command. Statements are bounded; the snapshot and the restore load set their
 * own limits inside their transactions. Idle errors never reach logs with the connection URL.
 */
export function backupPool(connectionString: string, max: number): BackupPool {
  const pool = new Pool({
    connectionString,
    max,
    connectionTimeoutMillis: 5000,
    statement_timeout: 120000,
    query_timeout: 15 * 60 * 1000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
  });
  pool.on('error', () => undefined);
  return pool;
}

/**
 * Session of one capture process. Lock order: 18471/4 shared (no offline repair while a capture
 * runs; workers and gateways hold it shared as well) → 18471/17 and 18471/20 shared (protocol
 * marks: without 17 online cleanup would treat this session as a legacy gateway) → 18471/19
 * exclusive (one capture per database). The writer lock is never taken: API and worker serve.
 */
export async function claimBackupSource(pool: Pool, storageId: string): Promise<StorageOwnership> {
  const client = await pool.connect();
  const ownership = new StorageOwnership(client);
  try {
    const maintenance = await client.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock_shared(18471,4) AS acquired',
    );
    if (maintenance.rows[0]?.acquired !== true)
      throw new BackupFailure('busy', 'Offline maintenance owns the database');
    await client.query(
      'SELECT pg_advisory_lock_shared(18471,17), pg_advisory_lock_shared(18471,20)',
    );
    const capture = await client.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock(18471,19) AS acquired',
    );
    if (capture.rows[0]?.acquired !== true)
      throw new BackupFailure('busy', 'Another capture is running for this database');
    const identity = await client.query<{ storage_id: string }>(
      'SELECT storage_id::text FROM arkvory_storage_identity WHERE singleton',
    );
    if (identity.rows[0]?.storage_id !== storageId)
      throw new BackupFailure('storage_mismatch', 'Database belongs to another storage directory');
    await ownership.start([4, 17, 19, 20]);
    return ownership;
  } catch (error) {
    await ownership.close();
    throw error;
  }
}

/** Published content of the source storage; pins keep every listed file in place. */
export class LocalContentSource implements ContentSource {
  constructor(private readonly blobs: LocalBlobStore) {}

  async *read(entry: InventoryEntry): AsyncIterable<Uint8Array> {
    try {
      yield* this.blobs.read(entry.id, entry.size);
    } catch (error) {
      if (hasCode(error, 'ENOENT'))
        throw new BackupFailure('blob_missing', 'Pinned content is missing from storage', {
          cause: error,
        });
      throw error;
    }
  }
}
