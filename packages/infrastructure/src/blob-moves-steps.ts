import { setTimeout as delay } from 'node:timers/promises';
import type { Pool, PoolClient } from 'pg';
import { ArkvoryError, DEFAULT_STORAGE_BACKEND, requireId } from '@proanima/arkvory-domain';
import type {
  Cancellation,
  CleanupBlobs,
  CopyRemoval,
  MovedUpload,
  UploadStorageSwitch,
} from '@proanima/arkvory-application';
import { contentLockKey, uploadLockKey } from './content-pins.js';
import { decode } from './postgres-catalog.js';
import { StorageOwnership } from './storage-ownership.js';
import { admitUnlink, finishUnlink } from './unlink-admission.js';

/** Advisory lock 18471/22: one process runs moves at a time (ADR 0083, N2). */
export const REHOME_LOCK = 22;

/** The session that holds 18471/22; `active` turns false for good when it is lost. */
export interface RehomeSingleton {
  readonly active: boolean;
  close(): Promise<void>;
}

/** Tries 18471/22 on a session of its own; null while another process holds it. */
export async function takeRehomeSingleton(pool: Pool): Promise<RehomeSingleton | null> {
  const client = await pool.connect();
  const ownership = new StorageOwnership(client);
  try {
    const lock = await client.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock(18471,$1::integer) AS acquired',
      [REHOME_LOCK],
    );
    if (lock.rows[0]?.acquired !== true) {
      await ownership.close();
      return null;
    }
    await ownership.start([REHOME_LOCK]);
    return {
      get active() {
        return ownership.active;
      },
      close: () => ownership.close(),
    };
  } catch (error) {
    await ownership.close();
    throw error;
  }
}

async function tryLock(client: PoolClient, key: string): Promise<boolean> {
  const result = await client.query<{ acquired: boolean }>(
    'SELECT pg_try_advisory_lock($1::bigint) AS acquired',
    [key],
  );
  return result.rows[0]?.acquired === true;
}

/** The upload side of a move on PostgreSQL. */
export class PostgresUploadSwitch implements UploadStorageSwitch {
  constructor(private readonly pool: Pool) {}

  async read(uploadId: string): Promise<MovedUpload | null> {
    const result = await this.pool.query<Record<string, unknown>>(
      'SELECT * FROM arkvory_uploads WHERE id=$1',
      [requireId(uploadId)],
    );
    if (!result.rows[0]) return null;
    const upload = decode(result.rows[0]);
    return {
      descriptor: upload.descriptor,
      status: upload.status,
      storageBackend: upload.storageBackend ?? DEFAULT_STORAGE_BACKEND,
    };
  }

  /**
   * One short transaction under the upload's lock, tried and never awaited, with no I/O inside:
   * the publication path, cleanup and other moves hold the same lock for their changes.
   */
  async switchStorage(uploadId: string, from: string, to: string) {
    const client = await this.pool.connect();
    let unusable = false;
    try {
      await client.query('BEGIN');
      const lock = await client.query<{ acquired: boolean }>(
        'SELECT pg_try_advisory_xact_lock($1::bigint) AS acquired',
        [uploadLockKey(uploadId)],
      );
      if (lock.rows[0]?.acquired !== true) {
        await client.query('ROLLBACK');
        return 'busy' as const;
      }
      const switched = await client.query(
        `UPDATE arkvory_uploads SET storage_backend=$3
         WHERE id=$1 AND storage_backend=$2 AND status='available'`,
        [uploadId, from, to],
      );
      const current = await client.query<{ storage_backend: string }>(
        'SELECT storage_backend FROM arkvory_uploads WHERE id=$1',
        [uploadId],
      );
      await client.query('COMMIT');
      if (switched.rowCount === 1 || current.rows[0]?.storage_backend === to)
        return 'switched' as const;
      return 'gone' as const;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {
        unusable = true;
      });
      throw error;
    } finally {
      client.release(unusable);
    }
  }
}

/**
 * Physical removal of one copy in the core's deletion order (ADR 0035, ADR 0054): upload lock
 * → content lock, both tried → unlink admission (barrier open, no backup pin of the upload) →
 * collect in the named storage. Any busy lock, a closed barrier, a pin or an unavailable
 * storage defers the removal. The session is destroyed afterwards, so its locks never outlive
 * the removal, and the loss of the session stops it between phases.
 */
export class PostgresCopyRemoval implements CopyRemoval {
  constructor(
    private readonly pool: Pool,
    private readonly blobs: CleanupBlobs,
  ) {}

  async remove(uploadId: string, backend: string, cancellation: Cancellation): Promise<boolean> {
    const keys = [uploadLockKey(uploadId), contentLockKey(uploadId)];
    const client = await this.pool.connect();
    const ownership = new StorageOwnership(client);
    let admitted = false;
    try {
      for (const key of keys) if (!(await tryLock(client, key))) return false;
      await ownership.startObjects(keys);
      admitted = await admitUnlink(client, uploadId);
      if (!admitted) return false;
      const check = {
        throwIfAborted() {
          cancellation.throwIfAborted();
          if (!ownership.active) throw new ArkvoryError('unavailable', 'Removal locks lost');
        },
      };
      try {
        await this.blobs.collect(uploadId, true, check, backend);
      } catch (error) {
        if (error instanceof ArkvoryError && error.code === 'busy') return false;
        throw error;
      }
      check.throwIfAborted();
      return true;
    } finally {
      if (admitted && ownership.active) await finishUnlink(client).catch(() => undefined);
      await ownership.close();
    }
  }
}

/**
 * Paces a copy to `bytesPerSecond` (ARKVORY_REHOME_BYTES_PER_SECOND): after each chunk the
 * stream waits until its bytes fit the rate, crediting at most one second of idle time, like
 * the backup copy (ADR 0056). Zero means no limit.
 */
export function pacedCopy(
  bytesPerSecond: number,
  monotonic: () => number = () => performance.now(),
): (source: AsyncIterable<Uint8Array>) => AsyncIterable<Uint8Array> {
  if (!Number.isSafeInteger(bytesPerSecond) || bytesPerSecond < 0)
    throw new Error('Invalid rehome bandwidth');
  if (bytesPerSecond === 0) return (source) => source;
  return async function* (source) {
    let nextAt = Number.NEGATIVE_INFINITY;
    for await (const chunk of source) {
      yield chunk;
      const now = monotonic();
      nextAt = Math.max(nextAt, now - 1000) + (chunk.byteLength * 1000) / bytesPerSecond;
      if (nextAt > now) await delay(nextAt - now);
    }
  };
}
