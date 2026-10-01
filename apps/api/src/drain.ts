import type { ServerResponse } from 'node:http';

/**
 * Graceful shutdown state for one API process. Admitted requests are tracked until their
 * response closes; after begin() new work is refused while tracked responses may finish.
 */
export class RequestDrain {
  private active = 0;
  private draining = false;
  private readonly settled = new Set<() => void>();
  private readonly beginHooks: (() => void)[] = [];

  get isDraining(): boolean {
    return this.draining;
  }

  get activeRequests(): number {
    return this.active;
  }

  /** Counts a response once; 'close' fires after completion and after client aborts alike. */
  track(response: ServerResponse): void {
    this.active++;
    response.once('close', () => {
      this.active--;
      if (this.active === 0) for (const resolve of [...this.settled]) resolve();
    });
  }

  onBegin(hook: () => void): void {
    this.beginHooks.push(hook);
  }

  begin(): void {
    if (this.draining) return;
    this.draining = true;
    for (const hook of this.beginHooks) hook();
  }

  /** Resolves true when every tracked response closed, false on timeout or abort. */
  settle(timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
    if (this.active === 0) return Promise.resolve(true);
    if (timeoutMs <= 0 || signal?.aborted) return Promise.resolve(false);
    return new Promise((resolve) => {
      const finish = (value: boolean) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', aborted);
        this.settled.delete(idle);
        resolve(value);
      };
      const idle = () => {
        finish(true);
      };
      const aborted = () => {
        finish(false);
      };
      const timer = setTimeout(aborted, timeoutMs);
      signal?.addEventListener('abort', aborted, { once: true });
      this.settled.add(idle);
    });
  }
}

/**
 * Stops admitting work, waits up to timeoutMs for admitted responses, then closes the server.
 * close() interrupts whatever is still running and destroys the remaining connections.
 */
export async function drainThenClose(
  app: { close(): PromiseLike<unknown> },
  drain: RequestDrain,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<boolean> {
  drain.begin();
  const settled = await drain.settle(timeoutMs, signal);
  await app.close();
  return settled;
}
