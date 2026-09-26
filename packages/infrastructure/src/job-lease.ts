import { ArkvoryError } from '@proanima/arkvory-domain';
import type { JobStore } from '@proanima/arkvory-application';
import { OwnershipWindow } from './ownership-window.js';

/** One renewal at a time; a thirty-second job reservation has an eight-second local window. */
export class PostgresJobLease {
  private readonly window = new OwnershipWindow();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: Promise<void> | undefined;
  private started = false;
  private stopped = false;
  constructor(
    private readonly jobs: Pick<JobStore, 'heartbeat' | 'finish'>,
    private readonly id: string,
    private readonly generation: number,
    private readonly ownerActive: () => boolean,
  ) {}
  get active(): boolean {
    const active = !this.stopped && this.ownerActive() && this.window.active;
    if (!active && this.started) this.stop();
    return active;
  }
  check(): void {
    if (!this.active) throw new ArkvoryError('unavailable', 'Completion job ownership lost');
  }
  async start(): Promise<void> {
    if (this.started || this.stopped) throw new Error('Job lease cannot be restarted');
    this.started = true;
    try {
      await this.renew();
      this.schedule();
    } catch (error) {
      this.stop();
      throw error;
    }
  }
  private async renew(): Promise<void> {
    const start = this.window.begin();
    if (!this.ownerActive() || !(await this.jobs.heartbeat(this.id, this.generation)))
      throw new ArkvoryError('unavailable', 'Completion job reservation lost');
    this.window.accept(start);
  }
  private schedule(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      if (!this.active) return;
      this.pending = this.renew().then(
        () => {
          this.schedule();
        },
        () => {
          this.stop();
        },
      );
    }, 2000);
    this.timer.unref();
  }
  async finish(errorCode: string | null): Promise<boolean> {
    // Drain the in-flight renewal, including the timer it may schedule, before finishing.
    clearTimeout(this.timer);
    const pending = this.pending;
    if (pending) await pending;
    clearTimeout(this.timer);
    try {
      if (!this.active) return false;
      return await this.jobs.finish(this.id, this.generation, errorCode);
    } finally {
      this.stop();
    }
  }
  stop(): void {
    this.stopped = true;
    this.window.stop();
    clearTimeout(this.timer);
  }
  async close(): Promise<void> {
    this.stop();
    await this.pending;
  }
}
