import type { Pool, PoolClient } from 'pg';
import { BackupFailure, requireId } from '@proanima/arkvory-domain';
import type { AgentLease } from '@proanima/arkvory-application';

/**
 * Guard of every agent write (ADR 0056): the statement succeeds only while this owner holds an
 * unexpired lease under the same generation. FOR SHARE makes a concurrent takeover wait for the
 * write instead of interleaving with it.
 */
export function agentFence(owner: number, generation: number): string {
  return `EXISTS (SELECT 1 FROM arkvory_backup_agent fence WHERE fence.singleton
    AND fence.owner=$${String(owner)}::uuid AND fence.generation=$${String(generation)}
    AND fence.lease_until>now() FOR SHARE)`;
}

export function leaseLost(): BackupFailure {
  return new BackupFailure('lease_lost', 'The backup agent lease was lost');
}

/** In a transaction: refuses with `lease_lost` unless the lease is still held. */
export async function requireAgentLease(client: PoolClient, lease: AgentLease): Promise<void> {
  lease.throwIfAborted();
  const held = await client.query(`SELECT 1 WHERE ${agentFence(1, 2)}`, [
    lease.owner,
    lease.generation,
  ]);
  if (held.rowCount !== 1) throw leaseLost();
}

/** What the agent reports with every renewal; identifiers and counts only, never paths. */
export interface AgentHeartbeat {
  readonly vaultConfigured: boolean;
  readonly vaultId: string | null;
  readonly vaultAvailable: boolean;
  readonly freeBytes: bigint | null;
  readonly totalBytes: bigint | null;
  readonly lastError: string | null;
}
export interface AgentLeaseOptions {
  readonly owner: string;
  readonly leaseSeconds: number;
  readonly version: string;
}

/**
 * Single active backup agent per database. A lease is acquired only when no owner holds an
 * unexpired one; every acquisition raises the generation, which fences all writes of earlier
 * owners. Renewal is also the heartbeat row read by the API and its metrics.
 */
export class PostgresAgentLease {
  constructor(
    private readonly pool: Pool,
    private readonly options: AgentLeaseOptions,
  ) {
    requireId(options.owner);
    if (
      !Number.isSafeInteger(options.leaseSeconds) ||
      options.leaseSeconds < 2 ||
      options.leaseSeconds > 3600
    )
      throw new BackupFailure('invalid_argument', 'Invalid agent lease duration');
  }

  /** Null when another agent holds a live lease (standby). */
  async acquire(heartbeat: () => Promise<AgentHeartbeat>): Promise<RenewedAgentLease | null> {
    const started = performance.now();
    const facts = await heartbeat();
    const acquired = await this.pool.query<{ generation: string }>(
      `UPDATE arkvory_backup_agent SET owner=$1, generation=generation+1,
        lease_until=now()+make_interval(secs=>$2), heartbeat_at=now(), started_at=now(),
        version=$3, vault_configured=$4, vault_id=$5, vault_available=$6, vault_free_bytes=$7,
        vault_total_bytes=$8, last_error=$9
       WHERE singleton AND (owner IS NULL OR lease_until<now()) RETURNING generation::text`,
      [this.options.owner, this.options.leaseSeconds, this.options.version, ...values(facts)],
    );
    const row = acquired.rows[0];
    if (!row) return null;
    return new RenewedAgentLease(
      this.options.owner,
      Number(row.generation),
      this.options.leaseSeconds * 1000,
      (lease) => this.renew(lease, heartbeat),
      started,
    );
  }

  private async renew(lease: RenewedAgentLease, heartbeat: () => Promise<AgentHeartbeat>) {
    const facts = await heartbeat();
    const renewed = await this.pool.query(
      `UPDATE arkvory_backup_agent SET lease_until=now()+make_interval(secs=>$3),
        heartbeat_at=now(), vault_configured=$4, vault_id=$5, vault_available=$6,
        vault_free_bytes=$7, vault_total_bytes=$8, last_error=$9
       WHERE singleton AND owner=$1 AND generation=$2 AND lease_until>now()`,
      [lease.owner, lease.generation, this.options.leaseSeconds, ...values(facts)],
    );
    return renewed.rowCount === 1;
  }

  /** Gives the lease up at once; the heartbeat time stays as the last time the agent was seen. */
  async release(lease: RenewedAgentLease): Promise<void> {
    await lease.close();
    await this.pool.query(
      `UPDATE arkvory_backup_agent SET owner=NULL, lease_until=NULL
       WHERE singleton AND owner=$1 AND generation=$2`,
      [lease.owner, lease.generation],
    );
  }
}

function values(facts: AgentHeartbeat): unknown[] {
  return [
    facts.vaultConfigured,
    facts.vaultId,
    facts.vaultAvailable,
    facts.freeBytes?.toString() ?? null,
    facts.totalBytes?.toString() ?? null,
    facts.lastError,
  ];
}

/**
 * Local view of the agent lease, renewed every third of its duration (at most every 20 s with
 * the default 60 s). It is trusted for two thirds of the lease from the start of each renewal,
 * so this agent stops before another may take over; a failed renewal is final.
 */
export class RenewedAgentLease implements AgentLease {
  private deadline: number;
  private lost = false;
  private closed = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: Promise<void> | undefined;

  constructor(
    readonly owner: string,
    readonly generation: number,
    private readonly leaseMs: number,
    private readonly renew: (lease: RenewedAgentLease) => Promise<boolean>,
    grantedAt: number,
    private readonly monotonic: () => number = () => performance.now(),
  ) {
    this.deadline = grantedAt + (leaseMs * 2) / 3;
    this.schedule();
  }

  get active(): boolean {
    return !this.closed && !this.lost && this.monotonic() < this.deadline;
  }

  throwIfAborted(): void {
    if (!this.active) throw leaseLost();
  }

  private schedule(): void {
    if (this.closed || this.lost) return;
    this.timer = setTimeout(
      () => {
        const started = this.monotonic();
        this.pending = this.renew(this).then(
          (renewed) => {
            if (!renewed || !this.active) this.lost = true;
            else this.deadline = started + (this.leaseMs * 2) / 3;
            this.schedule();
          },
          () => {
            this.lost = true;
          },
        );
      },
      Math.min(this.leaseMs / 3, 30000),
    );
    this.timer.unref();
  }

  async close(): Promise<void> {
    this.closed = true;
    clearTimeout(this.timer);
    await this.pending;
    clearTimeout(this.timer);
  }
}
