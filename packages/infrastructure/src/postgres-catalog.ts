import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import {
  ArkvoryError,
  descriptorWire,
  parseDescriptor,
  requireId,
  PART_BYTES,
  requireRepository,
  sameDescriptor,
} from '@proanima/arkvory-domain';
import type { Upload, MutationAccess } from '@proanima/arkvory-domain';
import { claimStorageSession } from './storage-claim.js';
import type { StorageRole } from './storage-claim.js';
import { StorageOwnership } from './storage-ownership.js';
import { lockServiceAccess } from './service-authorization.js';
import { accessCorrelation } from './request-correlation.js';
import { transitionUpload } from './upload-transition.js';
import { SCHEMA_VERSION } from './schema-version.js';
import type { Catalog, UploadMutation } from '@proanima/arkvory-application';

export function decode(row: Record<string, unknown> | undefined): Upload {
  if (!row) throw new ArkvoryError('not_found', 'Artifact or upload not found');
  const { id, repository, owner, descriptor, status, created_at: createdAt } = row;
  if (
    typeof id !== 'string' ||
    typeof repository !== 'string' ||
    typeof owner !== 'string' ||
    !(createdAt instanceof Date) ||
    !['pending', 'available', 'cancelled'].includes(String(status))
  )
    throw new ArkvoryError('unavailable', 'Invalid catalog record');
  if (status !== 'pending' && status !== 'available' && status !== 'cancelled')
    throw new ArkvoryError('unavailable', 'Invalid upload state');
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
            throw new ArkvoryError('unavailable', 'Invalid expiry');
          })(),
    storageBackend: typeof row['storage_backend'] === 'string' ? row['storage_backend'] : 'default',
    partBytes: typeof row['part_bytes'] === 'number' ? row['part_bytes'] : PART_BYTES,
  };
}

function catalogPool(connectionString: string, max: number): Pool {
  const pool = new Pool({
    connectionString,
    max,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
    query_timeout: 15000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
  });
  // Idle failures are retried by the pool; credentials must never reach logs.
  pool.on('error', () => undefined);
  return pool;
}

export class PostgresCatalog implements Catalog {
  readonly pool: Pool;
  private readonly locks: Pool;
  private claim: StorageOwnership | undefined;
  private claimAttempted = false;
  private claiming = false;
  /** poolSize bounds query connections; ownership, lease and pin sessions hold up to three. */
  constructor(
    connectionString: string,
    readonly capacityBytes: number,
    maxWriters: number,
    poolSize = 5,
  ) {
    if (!Number.isSafeInteger(poolSize) || poolSize < 4 || poolSize > 200)
      throw new Error('Invalid database pool size');
    this.pool = catalogPool(connectionString, poolSize);
    this.locks = catalogPool(connectionString, maxWriters);
  }

  get active(): boolean {
    return this.claim?.active ?? false;
  }

  async claimStorage(
    storageId: string,
    role: StorageRole = 'api',
    sharedDownloads = false,
  ): Promise<void> {
    if (this.claiming || this.claim)
      throw new ArkvoryError('conflict', 'Storage claim cannot be restarted', {
        reason: 'state_conflict',
      });
    this.claimAttempted = true;
    this.claiming = true;
    try {
      this.claim = await claimStorageSession(this.pool, storageId, role, sharedDownloads);
    } finally {
      this.claiming = false;
    }
  }

  private checkOwnership(): void {
    if (this.claimAttempted && !this.active)
      throw new ArkvoryError('unavailable', 'Storage ownership lost; restart the process');
  }

  async create(input: Parameters<Catalog['create']>[0]): Promise<Upload> {
    this.checkOwnership();
    const client = await this.pool.connect();
    let unusable = false;
    try {
      await client.query('BEGIN');
      // Serialize only reservations, never byte transfers.
      await client.query('SELECT pg_advisory_xact_lock(18471, 2)');
      await lockServiceAccess(client, input.access);
      const existing = await client.query<Record<string, unknown>>(
        'SELECT * FROM arkvory_uploads WHERE repository=$1 AND owner=$2 AND idempotency_key=$3',
        [input.repository, input.owner, input.key],
      );
      if (existing.rows[0]) {
        const upload = decode(existing.rows[0]);
        if (!sameDescriptor(upload.descriptor, input.descriptor))
          throw new ArkvoryError('conflict', 'Idempotency key has a different descriptor', {
            reason: 'idempotency_mismatch',
          });
        this.checkOwnership();
        await client.query('COMMIT');
        return upload;
      }
      // Capacity counts retained bytes only; catalog entries have no fixed count ceiling.
      const totals = await client.query<{ bytes: string }>(
        'SELECT COALESCE(SUM(size), 0)::text AS bytes FROM arkvory_uploads WHERE NOT reclaimed',
      );
      const total = totals.rows[0];
      if (
        !total ||
        BigInt(total.bytes) + BigInt(input.descriptor.size) > BigInt(this.capacityBytes)
      )
        throw new ArkvoryError('capacity_exceeded', 'Catalog capacity exceeded', {
          reason: 'catalog_limit',
        });
      const quota = (
        await client.query<{ quota: string | null; used: string }>(
          `
        SELECT p.policy->>'quotaBytes' AS quota,
        (SELECT COALESCE(sum(size),0)::text FROM arkvory_uploads WHERE repository=$1 AND NOT reclaimed) AS used
        FROM arkvory_storage_policies p WHERE p.repository=$1`,
          [input.repository],
        )
      ).rows[0];
      if (quota?.quota && BigInt(quota.used) + BigInt(input.descriptor.size) > BigInt(quota.quota))
        throw new ArkvoryError('capacity_exceeded', 'Repository storage quota exceeded', {
          reason: 'storage_quota',
        });
      const inserted = await client.query<Record<string, unknown>>(
        'INSERT INTO arkvory_uploads(id,repository,owner,idempotency_key,descriptor,size,created_at,storage_backend,part_bytes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
        [
          input.id,
          input.repository,
          input.owner,
          input.key,
          descriptorWire(input.descriptor),
          input.descriptor.size,
          input.createdAt,
          input.storageBackend ?? 'default',
          input.partBytes,
        ],
      );
      this.checkOwnership();
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
      'SELECT * FROM arkvory_uploads WHERE repository=$1 AND id=$2',
      [repository, id],
    );
    return decode(result.rows[0]);
  }

  async parts(id: string) {
    const result = await this.pool.query<{ part_index: number; size: number; sha256: string }>(
      'SELECT part_index,size,sha256 FROM arkvory_parts WHERE upload_id=$1 ORDER BY part_index',
      [id],
    );
    return result.rows.map((row) => ({
      index: row.part_index,
      size: row.size,
      sha256: row.sha256,
    }));
  }

  async part(id: string, index: number) {
    const result = await this.pool.query<{ part_index: number; size: number; sha256: string }>(
      'SELECT part_index,size,sha256 FROM arkvory_parts WHERE upload_id=$1 AND part_index=$2',
      [id, index],
    );
    const row = result.rows[0];
    return row ? { index: row.part_index, size: row.size, sha256: row.sha256 } : null;
  }

  async list(
    repository: string,
    after: string | undefined,
    limit: number,
  ): Promise<readonly Upload[]> {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT * FROM arkvory_uploads WHERE repository=$1 AND status='available' AND ($2::uuid IS NULL OR id > $2::uuid) ORDER BY id LIMIT $3`,
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
    const ownership = new StorageOwnership(client);
    try {
      const result = await client.query<{ acquired: boolean }>(
        'SELECT pg_try_advisory_lock($1::bigint) AS acquired',
        [key],
      );
      if (!result.rows[0]?.acquired)
        throw new ArkvoryError('busy', 'Upload is already being modified');
      await ownership.startObjects([key]);
      const check = (): void => {
        this.checkOwnership();
        if (!ownership.active) throw new ArkvoryError('unavailable', 'Upload lock was lost');
      };
      const guarded = async <R>(work: () => Promise<R>): Promise<R> => {
        check();
        await client.query('BEGIN');
        try {
          await lockServiceAccess(client, access);
          const result = await work();
          check();
          await client.query('COMMIT');
          return result;
        } catch (error) {
          try {
            await client.query('ROLLBACK');
          } catch {
            await ownership.close();
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
        return guarded(async () =>
          decode(await transitionUpload(client, repository, id, target, accessCorrelation(access))),
        );
      };
      const value = await action({
        recordPart: async (part) =>
          guarded(async () => {
            check();
            const result = await client.query(
              `INSERT INTO arkvory_parts(upload_id,part_index,size,sha256) SELECT id,$2,$3,$4 FROM arkvory_uploads WHERE id=$1 AND status='pending' AND expires_at>now() ON CONFLICT(upload_id,part_index) DO UPDATE SET sha256=excluded.sha256 WHERE arkvory_parts.sha256=excluded.sha256 AND arkvory_parts.size=excluded.size RETURNING upload_id`,
              [id, part.index, part.size, part.sha256],
            );
            if (result.rowCount !== 1)
              throw new ArkvoryError('conflict', 'Part cannot be recorded', {
                reason: 'upload_state',
              });
          }),
        throwIfAborted: check,
        publish: (repository) => transition(repository, 'available'),
        cancel: (repository) => transition(repository, 'cancelled'),
      });
      check();
      return value;
    } finally {
      await ownership.close();
    }
  }

  async ready(): Promise<void> {
    const result = await this.pool.query<{ applied: string; newest: number | null }>(
      'SELECT count(*) FILTER (WHERE version BETWEEN 1 AND $1)::text AS applied, max(version) AS newest FROM arkvory_migrations',
      [SCHEMA_VERSION],
    );
    const schema = result.rows[0];
    if (Number(schema?.applied) !== SCHEMA_VERSION)
      throw new ArkvoryError(
        'unavailable',
        `Database migrations 1 through ${String(SCHEMA_VERSION)} are required; run migrate`,
      );
    // A newer schema belongs to a newer release; this binary cannot know its invariants.
    if ((schema?.newest ?? 0) > SCHEMA_VERSION)
      throw new ArkvoryError('unavailable', 'Database schema is newer than this release');
    await this.pool.query('SELECT id,expires_at FROM arkvory_uploads LIMIT 0');
  }
  async close(): Promise<void> {
    await this.claim?.close();
    await Promise.all([this.pool.end(), this.locks.end()]);
  }
}
