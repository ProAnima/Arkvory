import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { StorageOwnership } from './storage-ownership.js';
import { ArkvoryError, requireId } from '@proanima/arkvory-domain';

export const contentLockKey = (id: string) =>
  createHash('sha256')
    .update('content:' + requireId(id))
    .digest()
    .readBigInt64BE()
    .toString();
export const uploadLockKey = (id: string) =>
  createHash('sha256').update(requireId(id)).digest().readBigInt64BE().toString();

/** One session per gateway, reference-counted shared locks; never one connection per stream. */
export class PostgresContentPins {
  private client: PoolClient | undefined;
  private ownership: StorageOwnership | undefined;
  private tail: Promise<unknown> = Promise.resolve();
  private readonly counts = new Map<string, number>();
  private lost = false;
  private closed = false;
  constructor(private readonly pool: Pool) {}
  private serial<T>(action: () => Promise<T> | T): Promise<T> {
    const next = this.tail.then(action);
    this.tail = next.catch(() => undefined);
    return next;
  }
  acquire(id: string) {
    return this.serial(async () => {
      if (this.ownership && !this.ownership.active) this.lost = true;
      if (this.lost && this.counts.size === 0 && !this.closed) {
        await this.ownership?.close();
        this.ownership = undefined;
        this.client = undefined;
        this.lost = false;
      }
      if (this.closed || this.lost)
        throw new ArkvoryError('unavailable', 'Content protection unavailable');
      if (!this.client) {
        this.client = await this.pool.connect();
        this.ownership = new StorageOwnership(this.client);
        try {
          await this.ownership.startConnection();
        } catch (error) {
          this.lost = true;
          await this.ownership.close();
          throw error;
        }
      }
      const key = contentLockKey(id),
        count = this.counts.get(key) ?? 0;
      if (count === 0) {
        try {
          const result = await this.client.query<{ acquired: boolean }>(
            'SELECT pg_try_advisory_lock_shared($1::bigint) AS acquired',
            [key],
          );
          if (!result.rows[0]?.acquired)
            throw new ArkvoryError('busy', 'Content is being reclaimed');
        } catch (error) {
          if (!(error instanceof ArkvoryError)) this.lost = true;
          throw error;
        }
      }
      this.counts.set(key, count + 1);
      let released = false;
      return {
        check: () => {
          if (released || this.lost || this.closed || !this.ownership?.active)
            throw new ArkvoryError('unavailable', 'Content protection lost');
        },
        release: () =>
          this.serial(async () => {
            if (released) return;
            released = true;
            const remaining = (this.counts.get(key) ?? 1) - 1;
            if (remaining > 0) {
              this.counts.set(key, remaining);
              return;
            }
            this.counts.delete(key);
            if (!this.lost && this.client) {
              try {
                await this.client.query('SELECT pg_advisory_unlock_shared($1::bigint)', [key]);
              } catch {
                this.lost = true;
              }
            }
          }),
      };
    });
  }
  close() {
    this.closed = true;
    return this.serial(async () => {
      await this.ownership?.close();
      this.client = undefined;
      this.ownership = undefined;
      this.counts.clear();
    });
  }
}
