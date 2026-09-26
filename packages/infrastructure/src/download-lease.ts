import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { ArkvoryError } from '@proanima/arkvory-domain';

export interface SharedDownloadPolicy {
  readonly slots: number;
  readonly slot: number;
  readonly bytesPerSecond: number;
  readonly perPrincipalBytesPerSecond: number;
}
export function downloadShare(policy: SharedDownloadPolicy) {
  if (
    !Number.isSafeInteger(policy.slots) ||
    policy.slots < 2 ||
    policy.slots > 16 ||
    !Number.isSafeInteger(policy.slot) ||
    policy.slot < 0 ||
    policy.slot >= policy.slots
  )
    throw new Error('Invalid shared gateway slot');
  for (const [rate, optional] of [
    [policy.bytesPerSecond, false],
    [policy.perPrincipalBytesPerSecond, true],
  ] as const) {
    if (
      !Number.isSafeInteger(rate) ||
      rate > 1024 ** 4 ||
      (rate < policy.slots * 65536 && !(optional && rate === 0))
    )
      throw new Error('Shared rate must allocate at least 65536 bytes/s to every slot');
  }
  return {
    bytesPerSecond: Math.floor(policy.bytesPerSecond / policy.slots),
    perPrincipalBytesPerSecond: Math.floor(policy.perPrincipalBytesPerSecond / policy.slots),
  };
}

/** Fail-closed local window; neither late responses nor process resume revive an expired owner. */
export class DownloadLeaseWindow {
  private monotonicDeadline = 0;
  private wallDeadline = 0;
  private stopped = false;
  private initialized = false;
  constructor(
    private readonly monotonic = () => performance.now(),
    private readonly wall = () => Date.now(),
  ) {}
  begin() {
    return { monotonic: this.monotonic(), wall: this.wall() };
  }
  accept(start: ReturnType<DownloadLeaseWindow['begin']>, initial = false) {
    if (
      this.stopped ||
      (initial && this.initialized) ||
      (!initial && !this.active) ||
      this.monotonic() >= start.monotonic + 8000 ||
      this.wall() >= start.wall + 8000
    ) {
      this.stop();
      throw new ArkvoryError('unavailable', 'Download budget lease expired; restart the gateway');
    }
    this.monotonicDeadline = start.monotonic + 8000;
    this.wallDeadline = start.wall + 8000;
    this.initialized = true;
  }
  get active() {
    if (!this.initialized) return false;
    if (this.monotonic() >= this.monotonicDeadline || this.wall() >= this.wallDeadline)
      this.stopped = true;
    return !this.stopped;
  }
  stop() {
    this.stopped = true;
  }
}

/** Fixed shares, ten-second DB leases, conservative eight-second local validity. */
export class PostgresDownloadLease {
  private readonly instance = randomUUID();
  private generation = '';
  private readonly window = new DownloadLeaseWindow();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private started = false;
  private closed = false;
  private renewing = false;
  constructor(
    private readonly pool: Pool,
    readonly policy: SharedDownloadPolicy,
  ) {
    downloadShare(policy);
  }
  get active() {
    return !this.closed && this.window.active;
  }
  get snapshot() {
    return {
      slot: this.policy.slot,
      slots: this.policy.slots,
      active: this.active,
      leaseSeconds: 10,
    };
  }

  async start() {
    if (this.started || this.closed) throw new Error('Download lease cannot be restarted');
    this.started = true;
    const start = this.window.begin();
    const client = await this.pool.connect();
    let broken = false;
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout='2s'");
      await client.query('SELECT pg_advisory_xact_lock(18471,8)');
      if (this.policy.slot === 0)
        await client.query(
          `INSERT INTO arkvory_download_policy(singleton,slots,bytes_per_second,principal_bytes_per_second)
        VALUES(true,$1,$2,$3) ON CONFLICT DO NOTHING`,
          [this.policy.slots, this.policy.bytesPerSecond, this.policy.perPrincipalBytesPerSecond],
        );
      const match = await client.query(
        `SELECT 1 FROM arkvory_download_policy WHERE singleton=true AND slots=$1 AND bytes_per_second=$2 AND principal_bytes_per_second=$3`,
        [this.policy.slots, this.policy.bytesPerSecond, this.policy.perPrincipalBytesPerSecond],
      );
      if (match.rowCount !== 1)
        throw new ArkvoryError(
          'conflict',
          'Shared download policy is absent or differs; start the configured writer first',
        );
      const acquired = await client.query<{ generation: string }>(
        `INSERT INTO arkvory_gateway_leases(slot,instance,generation,expires_at)
        VALUES($1,$2,1,clock_timestamp()+interval '10 seconds')
        ON CONFLICT(slot) DO UPDATE SET instance=excluded.instance,generation=arkvory_gateway_leases.generation+1,expires_at=excluded.expires_at
        WHERE arkvory_gateway_leases.expires_at<=clock_timestamp() RETURNING generation::text`,
        [this.policy.slot, this.instance],
      );
      const row = acquired.rows[0];
      if (!row) throw new ArkvoryError('busy', 'Download slot lease is still reserved');
      this.generation = row.generation;
      await client.query('COMMIT');
      this.window.accept(start, true);
      this.schedule();
    } catch (error) {
      this.close();
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

  private schedule() {
    if (this.closed) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.renew().then(
        () => {
          this.schedule();
        },
        () => {
          this.close();
        },
      );
    }, 2000);
  }

  async renew() {
    if (!this.active || this.renewing)
      throw new ArkvoryError('unavailable', 'Download budget lease is unavailable');
    this.renewing = true;
    const start = this.window.begin();
    const client = await this.pool.connect().catch((error: unknown) => {
      this.close();
      this.renewing = false;
      throw error;
    });
    let broken = false;
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout='2s'");
      const renewed = await client.query({
        text: `UPDATE arkvory_gateway_leases SET expires_at=clock_timestamp()+interval '10 seconds'
        WHERE slot=$1 AND instance=$2 AND generation=$3 AND expires_at>clock_timestamp() RETURNING slot`,
        values: [this.policy.slot, this.instance, this.generation],
      });
      if (renewed.rowCount !== 1)
        throw new ArkvoryError('unavailable', 'Download budget lease was lost');
      await client.query('COMMIT');
      this.window.accept(start);
    } catch (error) {
      this.close();
      try {
        await client.query('ROLLBACK');
      } catch {
        broken = true;
      }
      throw error;
    } finally {
      this.renewing = false;
      client.release(broken);
    }
  }

  close() {
    this.closed = true;
    this.window.stop();
    clearTimeout(this.timer);
    this.timer = undefined;
    // Keep the DB expiry: shutdown/lost acknowledgements must not immediately recycle a share.
  }
}
