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
    await this.startProbe(async () => {
      const result = await this.client.query<{ count: number }>({
        text: `SELECT count(DISTINCT objid)::integer AS count FROM pg_locks
          WHERE pid=pg_backend_pid() AND locktype='advisory' AND classid=18471
          AND objsubid=2 AND granted AND objid=ANY($1::oid[])
          AND database=(SELECT oid FROM pg_database WHERE datname=current_database())`,
        values: [locks],
      });
      return result.rows[0]?.count === locks.length;
    });
  }
  async startObjects(keys: readonly string[]): Promise<void> {
    await this.startProbe(async () => {
      const result = await this.client.query<{ count: number }>(
        `SELECT count(*)::integer AS count FROM pg_locks WHERE pid=pg_backend_pid()
          AND locktype='advisory' AND objsubid=1 AND granted AND mode='ExclusiveLock'
          AND ((classid::bigint << 32) | objid::bigint)=ANY($1::bigint[])
          AND database=(SELECT oid FROM pg_database WHERE datname=current_database())`,
        [keys],
      );
      return result.rows[0]?.count === keys.length;
    });
  }
  async startConnection(): Promise<void> {
    // Dynamic content pins change on this same session; only its liveness is probed here.
    await this.startProbe(async () => {
      await this.client.query('SELECT 1');
      return true;
    });
  }
  private async startProbe(probe: () => Promise<boolean>): Promise<void> {
    if (this.started || this.closed) throw new Error('Storage ownership cannot be restarted');
    this.started = true;
    await this.confirm(probe);
    this.schedule(probe);
  }
  private async confirm(probe: () => Promise<boolean>): Promise<void> {
    const start = this.window.begin();
    const deadline = setTimeout(() => {
      void this.close();
    }, 2000);
    deadline.unref();
    try {
      if (!(await probe()))
        throw new ArkvoryError('unavailable', 'Storage ownership locks were lost');
      this.window.accept(start);
    } finally {
      clearTimeout(deadline);
    }
  }
  private schedule(probe: () => Promise<boolean>): void {
    if (this.closed) return;
    this.timer = setTimeout(() => {
      if (!this.active) return;
      void this.confirm(probe).then(
        () => {
          this.schedule(probe);
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
    // pg may send a graceful Terminate for an idle client. A partition can hide its FIN forever;
    // explicitly close the typed driver stream, including TLS, without waiting on the peer.
    this.client.connection.stream.destroy();
    this.client.removeListener('error', this.failed);
    return this.ended;
  }
}
