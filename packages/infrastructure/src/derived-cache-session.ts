import type { Pool, PoolClient } from 'pg';
import { ModuleServiceError } from '@proanima/arkvory-extension-api';
import { StorageOwnership } from './storage-ownership.js';
import { cacheLock, unavailable } from './derived-cache-runtime.js';

/** One incarnation has exactly one owner session. Loss is terminal, never a reconnect. */
export class DerivedCacheSession {
  private opening: Promise<PoolClient> | undefined;
  private ownership: StorageOwnership | undefined;
  private stopped = false;
  constructor(
    private readonly pool: Pool,
    readonly owner: string,
  ) {}

  get(): Promise<PoolClient> {
    if (this.stopped) return Promise.reject(unavailable());
    return (this.opening ??= this.initialize());
  }

  private async initialize(): Promise<PoolClient> {
    const client = await this.pool.connect();
    this.ownership = new StorageOwnership(client);
    try {
      const locked = await client.query<{ acquired: boolean }>(
        'SELECT pg_try_advisory_lock($1::bigint) AS acquired',
        [cacheLock('owner', this.owner)],
      );
      if (!locked.rows[0]?.acquired) throw new ModuleServiceError('busy');
      await this.ownership.startObjects([cacheLock('owner', this.owner)]);
      await client.query('INSERT INTO arkvory_derived_cache_owners(id) VALUES($1)', [this.owner]);
      this.check();
      return client;
    } catch (error) {
      this.stopped = true;
      await this.ownership.close();
      throw error;
    }
  }

  check(): void {
    if (this.stopped || !this.ownership?.active) throw unavailable();
  }

  get started(): boolean {
    return this.opening !== undefined;
  }

  /** Existing owner only: shutdown must never acquire or reconnect a session. */
  async current(): Promise<PoolClient | undefined> {
    const client = await this.opening?.catch(() => undefined);
    try {
      this.check();
      return client;
    } catch {
      return undefined;
    }
  }

  async close(): Promise<void> {
    this.stopped = true;
    await this.opening?.catch(() => undefined);
    await this.ownership?.close();
  }
}
