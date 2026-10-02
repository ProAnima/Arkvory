import { BackupFailure } from '@proanima/arkvory-domain';
import type { CaptureLease } from '@proanima/arkvory-application';

export interface LeaseIdentity {
  readonly jobId: string;
  readonly pointId: string;
  readonly generation: number;
  readonly attempt: number;
  readonly owner: string;
}

/**
 * Local view of a stored capture lease. The database lease lasts `leaseMs` from each renewal;
 * locally it is trusted for two thirds of that, measured from the start of the renewal request,
 * so the process stops before another one may fence it. A failed renewal is final.
 */
export class RenewedCaptureLease implements CaptureLease {
  readonly jobId: string;
  readonly pointId: string;
  readonly generation: number;
  readonly attempt: number;
  readonly owner: string;
  private deadline: number;
  private lost = false;
  private closed = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: Promise<void> | undefined;

  constructor(
    identity: LeaseIdentity,
    private readonly leaseMs: number,
    private readonly renew: (lease: RenewedCaptureLease) => Promise<boolean>,
    grantedAt: number,
    private readonly monotonic: () => number = () => performance.now(),
  ) {
    this.jobId = identity.jobId;
    this.pointId = identity.pointId;
    this.generation = identity.generation;
    this.attempt = identity.attempt;
    this.owner = identity.owner;
    this.deadline = grantedAt + (leaseMs * 2) / 3;
    this.schedule();
  }

  get active(): boolean {
    return !this.closed && !this.lost && this.monotonic() < this.deadline;
  }

  throwIfAborted(): void {
    if (!this.active) throw new BackupFailure('lease_lost', 'Capture lease is no longer held');
  }

  private schedule(): void {
    if (this.closed || this.lost) return;
    this.timer = setTimeout(() => {
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
    }, this.leaseMs / 3);
    this.timer.unref();
  }

  async close(): Promise<void> {
    this.closed = true;
    clearTimeout(this.timer);
    await this.pending;
    clearTimeout(this.timer);
  }
}
