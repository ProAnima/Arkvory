import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { ModuleServiceError } from '@proanima/arkvory-extension-api';
import { StorageOwnership } from './storage-ownership.js';

export interface ModuleDataGuard {
  check(): void;
  /** Runs cleanup only while the previous writer's session lock is absent. */
  orphan(owner: string, remove: () => Promise<void>): Promise<void>;
}

export interface ModuleDataCoordinator {
  readonly owner: string;
  run<T>(module: string, work: (guard: ModuleDataGuard) => Promise<T>): Promise<T>;
}

const key = (kind: string, id: string) =>
  createHash('sha256').update(`module-data:${kind}:${id}`).digest().readBigInt64BE().toString();

/**
 * One monitored session per host, not per sink. Mutations are serialized locally because
 * PostgreSQL session locks are reentrant; across hosts they use a nonblocking module lock.
 * No SQL transaction spans filesystem I/O. As with the core storage ownership, loss is
 * terminal: this instance never reconnects and old operations must not publish after loss.
 */
export class PostgresModuleDataCoordinator implements ModuleDataCoordinator {
  readonly owner = randomUUID();
  private client: PoolClient | undefined;
  private ownership: StorageOwnership | undefined;
  private tail: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private stopped = false;
  private closing: Promise<void> | undefined;

  constructor(private readonly pool: Pool) {}

  private async connection(): Promise<PoolClient> {
    if (!this.client) {
      const client = await this.pool.connect();
      this.client = client;
      this.ownership = new StorageOwnership(client);
      try {
        const acquired = await this.tryLock(client, key('owner', this.owner));
        if (!acquired) throw new ModuleServiceError('busy');
        await this.ownership.startObjects([key('owner', this.owner)]);
      } catch (error) {
        this.stopped = true;
        await this.ownership.close();
        throw error;
      }
    }
    this.check();
    return this.client;
  }

  private check(): void {
    if (!this.ownership?.active) {
      this.stopped = true;
      throw new ModuleServiceError('unavailable', 'Module data ownership lost');
    }
  }

  private async tryLock(client: PoolClient, lock: string): Promise<boolean> {
    const result = await client.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock($1::bigint) AS acquired',
      [lock],
    );
    return result.rows[0]?.acquired === true;
  }

  private async locked<T>(module: string, work: (guard: ModuleDataGuard) => Promise<T>) {
    const client = await this.connection();
    const lock = key('module', module);
    if (!(await this.tryLock(client, lock))) throw new ModuleServiceError('busy');
    try {
      this.check();
      const result = await work({
        check: () => {
          this.check();
        },
        orphan: async (owner, remove) => {
          if (owner === this.owner) return;
          const previous = key('owner', owner);
          if (!(await this.tryLock(client, previous))) return;
          try {
            this.check();
            await remove();
            this.check();
          } finally {
            await client.query('SELECT pg_advisory_unlock($1::bigint)', [previous]);
          }
        },
      });
      this.check();
      return result;
    } finally {
      // A lost/unlock-failed session must never be reused, even if work threw first.
      await this.unlock(client, lock);
    }
  }

  private async unlock(client: PoolClient, lock: string): Promise<void> {
    try {
      await client.query('SELECT pg_advisory_unlock($1::bigint)', [lock]);
    } catch (error) {
      this.stopped = true;
      await this.ownership?.close();
      throw error;
    }
  }

  run<T>(module: string, work: (guard: ModuleDataGuard) => Promise<T>): Promise<T> {
    if (this.stopped) return Promise.reject(new ModuleServiceError('unavailable'));
    if (this.pending >= 64) return Promise.reject(new ModuleServiceError('busy'));
    this.pending++;
    const next = this.tail.then(() => this.locked(module, work));
    this.tail = next
      .catch(() => undefined)
      .finally(() => {
        this.pending--;
      });
    return next;
  }

  close(): Promise<void> {
    this.stopped = true;
    return (this.closing ??= this.tail.then(async () => {
      await this.ownership?.close();
    }));
  }
}
