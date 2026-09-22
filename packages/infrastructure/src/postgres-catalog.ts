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
import type { Upload } from '@proanima/depot-domain';
import type { Catalog, UploadMutation } from '@proanima/depot-application';

function decode(row: Record<string, unknown> | undefined): Upload {
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
    });
    this.locks = new Pool({
      connectionString,
      max: maxWriters,
      connectionTimeoutMillis: 5000,
      statement_timeout: 10000,
    });
    // Idle connection failures are retried by the pool; never leak connection strings in logs.
    this.pool.on('error', () => undefined);
    this.locks.on('error', () => undefined);
  }

  get active(): boolean {
    return this.claimed;
  }

  async claimStorage(storageId: string): Promise<void> {
    const client = await this.pool.connect();
    const state = { lost: false };
    const failed = (): void => {
      state.lost = true;
      this.claimed = false;
    };
    client.on('error', failed);
    try {
      // One API process per standalone database. This is deliberately not HA.
      const lock = await client.query<{ acquired: boolean }>(
        'SELECT pg_try_advisory_lock(18471, 3) AS acquired',
      );
      if (!lock.rows[0]?.acquired)
        throw new DepotError('busy', 'Another standalone API owns this database');
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
            await client.query('SELECT pg_advisory_unlock(18471,3)');
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
    try {
      await client.query('BEGIN');
      // Serialize only reservations, never byte transfers.
      await client.query('SELECT pg_advisory_xact_lock(18471, 2)');
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
        `SELECT COALESCE(SUM(size), 0)::text AS bytes, COUNT(*)::text AS entries FROM depot_uploads`,
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
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async get(repository: string, id: string): Promise<Upload> {
    const result = await this.pool.query<Record<string, unknown>>(
      'SELECT * FROM depot_uploads WHERE repository=$1 AND id=$2',
      [repository, id],
    );
    return decode(result.rows[0]);
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

  async exclusive<T>(id: string, action: (mutation: UploadMutation) => Promise<T>): Promise<T> {
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
      const transition = async (
        repository: string,
        target: 'available' | 'cancelled',
      ): Promise<Upload> => {
        check();
        // Use the SAME connection that owns the advisory lock. A lost connection
        // cannot commit a stale publication through the general-purpose pool.
        const updated = await client.query<Record<string, unknown>>(
          `UPDATE depot_uploads SET status=$3 WHERE repository=$1 AND id=$2 AND status IN ('pending',$3) RETURNING *`,
          [repository, id, target],
        );
        if (!updated.rows[0])
          throw new DepotError('conflict', 'Upload state prevents this operation');
        return decode(updated.rows[0]);
      };
      const value = await action({
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
    await this.pool.query('SELECT id FROM depot_uploads LIMIT 0');
  }
  async close(): Promise<void> {
    await this.releaseClaim?.();
    this.releaseClaim = undefined;
    await Promise.all([this.pool.end(), this.locks.end()]);
  }
}
