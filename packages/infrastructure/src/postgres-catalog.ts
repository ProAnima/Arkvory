import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import {
  DepotError,
  descriptorWire,
  parseDescriptor,
  requireId,
  requireRepository,
  sameDescriptor,
} from '@proanima/depot-domain';
import type { Upload, MutationAccess } from '@proanima/depot-domain';
import { lockServiceAccess } from './service-authorization.js';
import type { Catalog, UploadMutation } from '@proanima/depot-application';

export function decode(row: Record<string, unknown> | undefined): Upload {
  if (!row) throw new DepotError('not_found', 'Artifact or upload not found');
  const { id, repository, owner, descriptor, status, created_at: createdAt } = row;
  if (
    typeof id !== 'string' ||
    typeof repository !== 'string' ||
    typeof owner !== 'string' ||
    !(createdAt instanceof Date) ||
    !['pending', 'available', 'cancelled'].includes(String(status))
  )
    throw new DepotError('unavailable', 'Invalid catalog record');
  if (status !== 'pending' && status !== 'available' && status !== 'cancelled')
    throw new DepotError('unavailable', 'Invalid upload state');
  return {
    id: requireId(id),
    repository: requireRepository(repository),
    owner,
    descriptor: parseDescriptor(descriptor),
    status,
    createdAt: createdAt.toISOString(),
    expiresAt:
      row['expires_at'] instanceof Date
        ? row['expires_at'].toISOString()
        : (() => {
            throw new DepotError('unavailable', 'Invalid expiry');
          })(),
  };
}

export class PostgresCatalog implements Catalog {
  readonly pool: Pool;
  private readonly locks: Pool;
  private releaseClaim: (() => Promise<void>) | undefined;
  private claimed = false;
  constructor(
    connectionString: string,
    private readonly capacityBytes: number,
    maxWriters: number,
  ) {
    this.pool = new Pool({
      connectionString,
      max: 5,
      connectionTimeoutMillis: 5000,
      statement_timeout: 10000,
      query_timeout: 15000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
    });
    this.locks = new Pool({
      connectionString,
      max: maxWriters,
      connectionTimeoutMillis: 5000,
      statement_timeout: 10000,
      query_timeout: 15000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
    });
    // Idle connection failures are retried by the pool; never leak connection strings in logs.
    this.pool.on('error', () => undefined);
    this.locks.on('error', () => undefined);
  }

  get active(): boolean {
    return this.claimed;
  }

  async claimStorage(
    storageId: string,
    role: 'api' | 'reader' | 'worker' | 'maintenance' = 'api',
    sharedDownloads = false,
  ): Promise<void> {
    const client = await this.pool.connect();
    const state = { lost: false };
    const failed = (): void => {
      state.lost = true;
      this.claimed = false;
    };
    client.on('error', failed);
    try {
      if (role === 'reader' && !sharedDownloads)
        throw new DepotError('invalid_input', 'Reader requires shared download policy');
      if (role === 'api' || role === 'reader') {
        const mode = await client.query<{ acquired: boolean }>(
          sharedDownloads
            ? 'SELECT pg_try_advisory_lock_shared(18471,7) AS acquired'
            : 'SELECT pg_try_advisory_lock(18471,7) AS acquired',
        );
        if (!mode.rows[0]?.acquired)
          throw new DepotError('busy', 'Conflicting gateway profile is active');
        if (!sharedDownloads) {
          const policy = await client.query('SELECT 1 FROM depot_download_policy');
          if (policy.rowCount)
            throw new DepotError('conflict', 'Database requires shared download configuration');
        }
      }
      // One writer per database, including the shared-download profile. This is not HA.
      if (role === 'worker') {
        const worker = await client.query<{ acquired: boolean }>(
          'SELECT pg_try_advisory_lock(18471,6) AS acquired',
        );
        if (!worker.rows[0]?.acquired)
          throw new DepotError('busy', 'Standalone supports one completion worker');
      }
      if (role !== 'worker' && role !== 'reader') {
        const lock = await client.query<{ acquired: boolean }>(
          'SELECT pg_try_advisory_lock(18471,3) AS acquired',
        );
        if (!lock.rows[0]?.acquired)
          throw new DepotError('busy', 'Another writer or maintenance process owns this database');
      }
      const barrier = await client.query<{ acquired: boolean }>(
        role === 'maintenance'
          ? 'SELECT pg_try_advisory_lock(18471,4) AS acquired'
          : 'SELECT pg_try_advisory_lock_shared(18471,4) AS acquired',
      );
      if (!barrier.rows[0]?.acquired)
        throw new DepotError('busy', 'Maintenance requires all gateways and workers to be stopped');
      if (role === 'reader') {
        const legacy = await client.query(`SELECT 1 FROM pg_locks writer
          WHERE writer.locktype='advisory' AND writer.classid=18471 AND writer.objid=3 AND writer.objsubid=2 AND writer.granted
          AND writer.database=(SELECT oid FROM pg_database WHERE datname=current_database())
          AND NOT EXISTS(SELECT 1 FROM pg_locks mode WHERE mode.pid=writer.pid AND mode.locktype='advisory'
            AND mode.classid=18471 AND mode.objid=7 AND mode.objsubid=2 AND mode.granted)`);
        if (legacy.rowCount)
          throw new DepotError('busy', 'Upgrade the writer before starting read gateways');
      }
      if (role !== 'reader')
        await client.query(
          'INSERT INTO depot_storage_identity(singleton,storage_id) VALUES(true,$1) ON CONFLICT DO NOTHING',
          [requireId(storageId)],
        );
      const identity = await client.query<{ storage_id: string }>(
        'SELECT storage_id FROM depot_storage_identity WHERE singleton=true',
      );
      if (identity.rows[0]?.storage_id !== storageId)
        throw new DepotError('conflict', 'Database belongs to a different storage directory');
      this.claimed = true;
      this.releaseClaim = async () => {
        this.claimed = false;
        if (!state.lost) {
          try {
            await client.query('SELECT pg_advisory_unlock_all()');
          } catch {
            state.lost = true;
          }
        }
        client.removeListener('error', failed);
        client.release(state.lost);
      };
    } catch (error) {
      client.removeListener('error', failed);
      client.release(true);
      throw error;
    }
  }

  async create(input: Parameters<Catalog['create']>[0]): Promise<Upload> {
    const client = await this.pool.connect();
    let unusable = false;
    try {
      await client.query('BEGIN');
      // Serialize only reservations, never byte transfers.
      await client.query('SELECT pg_advisory_xact_lock(18471, 2)');
      await lockServiceAccess(client, input.access);
      const existing = await client.query<Record<string, unknown>>(
        'SELECT * FROM depot_uploads WHERE repository=$1 AND owner=$2 AND idempotency_key=$3',
        [input.repository, input.owner, input.key],
      );
      if (existing.rows[0]) {
        const upload = decode(existing.rows[0]);
        if (!sameDescriptor(upload.descriptor, input.descriptor))
          throw new DepotError('conflict', 'Idempotency key has a different descriptor');
        await client.query('COMMIT');
        return upload;
      }
      const totals = await client.query<{ bytes: string; entries: string }>(
        `SELECT COALESCE(SUM(size) FILTER(WHERE NOT reclaimed), 0)::text AS bytes, COUNT(*)::text AS entries FROM depot_uploads`,
      );
      const total = totals.rows[0];
      if (
        !total ||
        BigInt(total.bytes) + BigInt(input.descriptor.size) > BigInt(this.capacityBytes) ||
        Number(total.entries) >= 100000
      )
        throw new DepotError('capacity_exceeded', 'Catalog capacity exceeded');
      const inserted = await client.query<Record<string, unknown>>(
        'INSERT INTO depot_uploads(id,repository,owner,idempotency_key,descriptor,size,created_at) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
        [
          input.id,
          input.repository,
          input.owner,
          input.key,
          descriptorWire(input.descriptor),
          input.descriptor.size,
          input.createdAt,
        ],
      );
      await client.query('COMMIT');
      return decode(inserted.rows[0]);
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        unusable = true;
      }
      throw error;
    } finally {
      client.release(unusable);
    }
  }

  async get(repository: string, id: string): Promise<Upload> {
    const result = await this.pool.query<Record<string, unknown>>(
      'SELECT * FROM depot_uploads WHERE repository=$1 AND id=$2',
      [repository, id],
    );
    return decode(result.rows[0]);
  }

  async parts(id: string) {
    const result = await this.pool.query<{ part_index: number; size: number; sha256: string }>(
      'SELECT part_index,size,sha256 FROM depot_parts WHERE upload_id=$1 ORDER BY part_index',
      [id],
    );
    return result.rows.map((row) => ({
      index: row.part_index,
      size: row.size,
      sha256: row.sha256,
    }));
  }

  async list(
    repository: string,
    after: string | undefined,
    limit: number,
  ): Promise<readonly Upload[]> {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT * FROM depot_uploads WHERE repository=$1 AND status='available' AND ($2::uuid IS NULL OR id > $2::uuid) ORDER BY id LIMIT $3`,
      [repository, after ?? null, limit],
    );
    return result.rows.map(decode);
  }

  async exclusive<T>(
    id: string,
    action: (mutation: UploadMutation) => Promise<T>,
    access?: MutationAccess,
  ): Promise<T> {
    const client = await this.locks.connect();
    const key = createHash('sha256').update(id).digest().readBigInt64BE().toString();
    const state = { lost: false };
    const onError = (): void => {
      state.lost = true;
    };
    client.on('error', onError);
    try {
      const result = await client.query<{ acquired: boolean }>(
        'SELECT pg_try_advisory_lock($1::bigint) AS acquired',
        [key],
      );
      if (!result.rows[0]?.acquired)
        throw new DepotError('busy', 'Upload is already being modified');
      const check = (): void => {
        if (state.lost) throw new DepotError('unavailable', 'Upload lock was lost');
      };
      const guarded = async <R>(work: () => Promise<R>): Promise<R> => {
        check();
        await client.query('BEGIN');
        try {
          await lockServiceAccess(client, access);
          const result = await work();
          await client.query('COMMIT');
          return result;
        } catch (error) {
          try {
            await client.query('ROLLBACK');
          } catch {
            state.lost = true;
          }
          throw error;
        }
      };
      const transition = async (
        repository: string,
        target: 'available' | 'cancelled',
      ): Promise<Upload> => {
        check();
        // Use the SAME connection that owns the advisory lock. A lost connection
        // cannot commit a stale publication through the general-purpose pool.
        return guarded(async () => {
          const updated = await client.query<Record<string, unknown>>(
            `UPDATE depot_uploads SET status=$3, cancelled_at=CASE WHEN $3='cancelled' THEN COALESCE(cancelled_at,now()) ELSE cancelled_at END WHERE repository=$1 AND id=$2 AND status IN ('pending',$3) AND (status='available' OR $3='cancelled' OR expires_at>now()) RETURNING *`,
            [repository, id, target],
          );
          if (!updated.rows[0])
            throw new DepotError('conflict', 'Upload state prevents this operation');
          return decode(updated.rows[0]);
        });
      };
      const value = await action({
        recordPart: async (part) =>
          guarded(async () => {
            check();
            const result = await client.query(
              `INSERT INTO depot_parts(upload_id,part_index,size,sha256) SELECT id,$2,$3,$4 FROM depot_uploads WHERE id=$1 AND status='pending' AND expires_at>now() ON CONFLICT(upload_id,part_index) DO UPDATE SET sha256=excluded.sha256 WHERE depot_parts.sha256=excluded.sha256 AND depot_parts.size=excluded.size RETURNING upload_id`,
              [id, part.index, part.size, part.sha256],
            );
            if (result.rowCount !== 1) throw new DepotError('conflict', 'Part cannot be recorded');
          }),
        throwIfAborted: check,
        publish: (repository) => transition(repository, 'available'),
        cancel: (repository) => transition(repository, 'cancelled'),
      });
      if (state.lost)
        throw new DepotError('unavailable', 'Upload lock connection was lost; query upload status');
      return value;
    } finally {
      if (!state.lost) {
        try {
          await client.query('SELECT pg_advisory_unlock($1::bigint)', [key]);
        } catch {
          state.lost = true;
        }
      }
      client.removeListener('error', onError);
      client.release(state.lost);
    }
  }

  async ready(): Promise<void> {
    const result = await this.pool.query(
      'SELECT version FROM depot_migrations WHERE version IN (8,9)',
    );
    if (result.rowCount !== 2)
      throw new DepotError('unavailable', 'Database migrations 8 and 9 are required');
    await this.pool.query('SELECT id,expires_at FROM depot_uploads LIMIT 0');
  }
  async close(): Promise<void> {
    await this.releaseClaim?.();
    this.releaseClaim = undefined;
    await Promise.all([this.pool.end(), this.locks.end()]);
  }
}
