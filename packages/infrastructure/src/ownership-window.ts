import { ArkvoryError } from '@proanima/arkvory-domain';

/** Bounded observation of a PostgreSQL owner, not a distributed fencing token. */
export class OwnershipWindow {
  private deadline: { monotonic: number; wall: number } | undefined;
  private stopped = false;
  constructor(
    private readonly monotonic = () => performance.now(),
    private readonly wall = () => Date.now(),
  ) {}
  begin() {
    return { monotonic: this.monotonic(), wall: this.wall() };
  }
  accept(start: ReturnType<OwnershipWindow['begin']>) {
    // Charge network latency to the validity window. Late replies never revive an owner.
    if (
      this.stopped ||
      (this.deadline !== undefined && !this.active) ||
      this.monotonic() >= start.monotonic + 8000 ||
      this.wall() >= start.wall + 8000
    ) {
      this.stop();
      throw new ArkvoryError('unavailable', 'Storage ownership expired; restart the process');
    }
    this.deadline = { monotonic: start.monotonic + 8000, wall: start.wall + 8000 };
  }
  get active(): boolean {
    if (!this.deadline) return false;
    if (this.monotonic() >= this.deadline.monotonic || this.wall() >= this.deadline.wall)
      this.stop();
    return !this.stopped;
  }
  stop(): void {
    this.stopped = true;
  }
}
