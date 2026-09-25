import type { Pool } from 'pg';
import { DepotError } from '@proanima/depot-domain';
import type { MutationAccess } from '@proanima/depot-domain';
import { lockServiceAccess } from './service-authorization.js';
import type { CleanupCatalog, CompletionJob, JobStore } from '@proanima/depot-application';
import type { Cancellation } from '@proanima/depot-application';
import { contentLockKey, uploadLockKey } from './content-pins.js';

export class PostgresCleanup implements CleanupCatalog {
  constructor(private readonly pool: Pool) {}
  async exclusive<T>(
    id: string,
    removeContent: boolean,
    action: (cancellation: Cancellation) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    const state = { lost: false };
    const failed = () => {
      state.lost = true;
    };
    const keys = [uploadLockKey(id), ...(removeContent ? [contentLockKey(id)] : [])];
    const acquired: string[] = [];
    client.on('error', failed);
    try {
      // Independent of the process-wide maintenance claim: a replacement gateway cannot
      // race an already admitted unlink when that other session disconnects.
      for (const key of keys) {
        const result = await client.query<{ acquired: boolean }>(
          'SELECT pg_try_advisory_lock($1::bigint) AS acquired',
          [key],
        );
        if (!result.rows[0]?.acquired) throw new DepotError('busy', 'Cleanup object is in use');
        acquired.push(key);
      }
      const cancellation = {
        throwIfAborted() {
          if (state.lost) throw new DepotError('unavailable', 'Cleanup object protection lost');
        },
      };
      cancellation.throwIfAborted();
      const result = await action(cancellation);
      cancellation.throwIfAborted();
      return result;
    } finally {
      if (!state.lost) {
        try {
          for (const key of acquired.reverse())
            await client.query('SELECT pg_advisory_unlock($1::bigint)', [key]);
        } catch {
          state.lost = true;
        }
      }
      client.removeListener('error', failed);
      client.release(state.lost);
    }
  }
  async page(after: string | undefined, limit: number) {
    const result = await this.pool.query<{
      id: string;
      repository: string;
      status: 'pending' | 'available' | 'cancelled';
      expires_at: Date;
      cancelled_at: Date | null;
    }>(
      'SELECT id,repository,status,expires_at,cancelled_at FROM depot_uploads WHERE ($1::uuid IS NULL OR id>$1) ORDER BY id LIMIT $2',
      [after ?? null, limit],
    );
    return result.rows.map((row) => ({
      id: row.id,
      repository: row.repository,
      status: row.status,
      expiresAt: row.expires_at.toISOString(),
      cancelledAt: row.cancelled_at?.toISOString() ?? null,
    }));
  }
  async expire(id: string, now: string) {
    await this.pool.query(
      `UPDATE depot_uploads SET status='cancelled',cancelled_at=$2 WHERE id=$1 AND status='pending' AND expires_at<=$2`,
      [id, now],
    );
  }
  async reclaimed(id: string) {
    const result = await this.pool.query(
      `UPDATE depot_uploads SET reclaimed=true WHERE id=$1 AND status='cancelled'`,
      [id],
    );
    if (result.rowCount !== 1)
      throw new DepotError('conflict', 'Only cancelled data may be reclaimed');
  }
}

function job(row: Record<string, unknown> | undefined): CompletionJob {
  if (!row) throw new DepotError('not_found', 'Job not found');
  const {
    id,
    repository,
    upload_id: uploadId,
    owner,
    status,
    generation,
    attempts,
    error_code: errorCode,
  } = row;
  if (
    typeof id !== 'string' ||
    typeof repository !== 'string' ||
    typeof uploadId !== 'string' ||
    typeof owner !== 'string' ||
    !['queued', 'running', 'completed', 'failed'].includes(String(status)) ||
    typeof generation !== 'number' ||
    typeof attempts !== 'number' ||
    (errorCode !== null && typeof errorCode !== 'string')
  )
    throw new DepotError('unavailable', 'Invalid job record');
  if (status !== 'queued' && status !== 'running' && status !== 'completed' && status !== 'failed')
    throw new DepotError('unavailable', 'Invalid job state');
  const credential = row['credential_id'];
  if (credential !== undefined && credential !== null && typeof credential !== 'string')
    throw new DepotError('unavailable', 'Invalid job credential');
  return {
    id,
    repository,
    uploadId,
    owner,
    status,
    generation,
    attempts,
    errorCode,
    ...(typeof credential === 'string' ? { credentialId: credential } : {}),
  };
}

export class PostgresJobs implements JobStore {
  constructor(private readonly pool: Pool) {}
  async enqueue(
    repository: string,
    uploadId: string,
    owner: string,
    id: string,
    access?: MutationAccess,
  ) {
    const client = await this.pool.connect();
    let broken = false;
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(18471,5)');
      await lockServiceAccess(client, access);
      const prior = await client.query<Record<string, unknown>>(
        'SELECT * FROM depot_jobs WHERE upload_id=$1 AND repository=$2 AND owner=$3 FOR UPDATE',
        [uploadId, repository, owner],
      );
      if (prior.rows[0]) {
        const previous = job(prior.rows[0]);
        const credential = access?.principal.managed?.keyId;
        if (credential && previous.credentialId !== credential && previous.status !== 'completed') {
          if (previous.status === 'running')
            throw new DepotError('busy', 'Wait for the running job before reauthorizing');
          const limits = (
            await client.query<{ total: string; owned: string }>(
              "SELECT count(*)::text AS total,count(*) FILTER(WHERE owner=$1)::text AS owned FROM depot_jobs WHERE status IN ('queued','running')",
              [owner],
            )
          ).rows[0];
          if (
            previous.status === 'failed' &&
            (!limits || Number(limits.total) >= 10000 || Number(limits.owned) >= 100)
          )
            throw new DepotError('capacity_exceeded', 'Completion queue is full');
          const updated = await client.query<Record<string, unknown>>(
            "UPDATE depot_jobs SET credential_id=$2,status='queued',attempts=0,generation=generation+1,error_code=NULL,available_at=now() WHERE id=$1 RETURNING *",
            [previous.id, credential],
          );
          await client.query('COMMIT');
          return job(updated.rows[0]);
        }
        await client.query('COMMIT');
        return job(prior.rows[0]);
      }
      const count = await client.query<{ total: string; owned: string }>(
        `SELECT count(*)::text AS total,count(*) FILTER(WHERE owner=$1)::text AS owned FROM depot_jobs WHERE status IN ('queued','running')`,
        [owner],
      );
      if (Number(count.rows[0]?.total) >= 10000 || Number(count.rows[0]?.owned) >= 100)
        throw new DepotError('capacity_exceeded', 'Completion queue is full');
      const inserted = await client.query<Record<string, unknown>>(
        `INSERT INTO depot_jobs(id,repository,upload_id,owner,credential_id) SELECT $1,repository,id,owner,$5 FROM depot_uploads WHERE id=$2 AND repository=$3 AND owner=$4 AND status='pending' AND expires_at>now() RETURNING *`,
        [id, uploadId, repository, owner, access?.principal.managed?.keyId ?? null],
      );
      if (!inserted.rows[0])
        throw new DepotError('conflict', 'Upload is not eligible for completion');
      await client.query('COMMIT');
      return job(inserted.rows[0]);
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        broken = true;
      }
      throw error;
    } finally {
      client.release(broken);
    }
  }
  async get(id: string) {
    return job(
      (await this.pool.query<Record<string, unknown>>('SELECT * FROM depot_jobs WHERE id=$1', [id]))
        .rows[0],
    );
  }
  async take() {
    await this.pool.query(
      `UPDATE depot_jobs SET status='failed',error_code='attempts_exhausted' WHERE status='running' AND lease_until<now() AND attempts>=5`,
    );
    const result = await this.pool.query<Record<string, unknown>>(
      `WITH candidate AS (SELECT id FROM depot_jobs WHERE attempts<5 AND ((status='queued' AND available_at<=now()) OR (status='running' AND lease_until<now())) ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE depot_jobs j SET status='running',generation=generation+1,attempts=attempts+1,lease_until=now()+interval '30 seconds' FROM candidate WHERE j.id=candidate.id RETURNING j.*`,
    );
    return result.rows[0] ? job(result.rows[0]) : null;
  }
  async heartbeat(id: string, generation: number) {
    const result = await this.pool.query(
      `UPDATE depot_jobs SET lease_until=now()+interval '30 seconds' WHERE id=$1 AND generation=$2 AND status='running' AND lease_until>now()`,
      [id, generation],
    );
    return result.rowCount === 1;
  }
  async finish(id: string, generation: number, errorCode: string | null) {
    const result = await this.pool.query(
      `UPDATE depot_jobs SET status=CASE WHEN $3::text IS NULL THEN 'completed' WHEN attempts>=5 OR $3 IN ('forbidden','invalid_input','integrity_mismatch','not_found') THEN 'failed' ELSE 'queued' END,error_code=$3,available_at=now()+make_interval(secs=>LEAST(60,power(2,attempts)::integer)),lease_until=NULL WHERE id=$1 AND generation=$2 AND status='running' AND lease_until>now()`,
      [id, generation, errorCode],
    );
    return result.rowCount === 1;
  }
}
