import type { PoolClient } from 'pg';
import { ArkvoryError } from '@proanima/arkvory-domain';
import { OwnershipWindow } from './ownership-window.js';

/** Owns exactly one dedicated connection; checks cannot reconnect or reacquire lost locks. */
export class StorageOwnership {
  private readonly window = new OwnershipWindow();
  private closed = false;
  private started = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly ended: Promise<void>;
  private readonly failed = () => {
    void this.close();
  };
  constructor(private readonly client: PoolClient) {
    this.ended = new Promise((resolve) => client.once('end', resolve));
    client.on('error', this.failed);
  }
  get active(): boolean {
    const active = !this.closed && this.window.active;
    if (!active && this.started) void this.close();
    return active;
  }
  async start(locks: readonly number[]): Promise<void> {
    if (this.started || this.closed) throw new Error('Storage ownership cannot be restarted');
    this.started = true;
    await this.confirm(locks);
    this.schedule(locks);
  }
  private async confirm(locks: readonly number[]): Promise<void> {
    const start = this.window.begin();
    const deadline = setTimeout(() => {
      void this.close();
    }, 2000);
    deadline.unref();
    try {
      const result = await this.client.query<{ count: number }>({
        text: `SELECT count(DISTINCT objid)::integer AS count FROM pg_locks
        WHERE pid=pg_backend_pid() AND locktype='advisory' AND classid=18471
        AND objsubid=2 AND granted AND objid=ANY($1::oid[])
        AND database=(SELECT oid FROM pg_database WHERE datname=current_database())`,
        values: [locks],
      });
      if (result.rows[0]?.count !== locks.length)
        throw new ArkvoryError('unavailable', 'Storage ownership locks were lost');
      this.window.accept(start);
    } finally {
      clearTimeout(deadline);
    }
  }
  private schedule(locks: readonly number[]): void {
    if (this.closed) return;
    this.timer = setTimeout(() => {
      if (!this.active) return;
      void this.confirm(locks).then(
        () => {
          this.schedule(locks);
        },
        () => {
          void this.close();
        },
      );
    }, 2000);
    this.timer.unref();
  }
  close(): Promise<void> {
    if (this.closed) return this.ended;
    this.closed = true;
    this.window.stop();
    clearTimeout(this.timer);
    // Destroy instead of returning a connection with uncertain session locks to the pool.
    this.client.release(true);
    this.client.removeListener('error', this.failed);
    return this.ended;
  }
}
