export type DownloadState =
  | 'queued'
  | 'running'
  | 'retrying'
  | 'pausing'
  | 'paused'
  | 'saving'
  | 'cancelling'
  | 'cancelled'
  | 'completed'
  | 'failed';
export interface DownloadQueuePolicy {
  readonly concurrency?: number;
  readonly maxEntries?: number;
  readonly startIntervalMs?: number;
  readonly queueTimeoutMs?: number;
}
export interface DownloadContext {
  readonly signal: AbortSignal;
  progress(bytes: number): void;
  retry(event: { attempt: number; delayMs: number }): void;
  /** Final local commit: after this point pause/cancel are refused. */
  beginCommit(): void;
}
export interface DownloadJob {
  readonly id: string;
  /** Preserve a checkpoint before rejecting an aborted attempt. Never commit unchecked bytes. */
  run(context: DownloadContext): Promise<void>;
  /** Idempotently remove only this job's temporary data; never remove the final destination. */
  discard(): Promise<void>;
}
export interface DownloadSnapshot {
  readonly id: string;
  readonly state: DownloadState;
  readonly bytes: number;
  readonly retry: { readonly attempt: number; readonly delayMs: number } | null;
  readonly error: unknown;
  readonly resumable: boolean;
}
export interface DownloadQueueClock {
  now(): number;
  schedule(action: () => void, milliseconds: number): () => void;
}
const clock: DownloadQueueClock = {
  now: () => performance.now(),
  schedule(action, milliseconds) {
    const timer = setTimeout(action, milliseconds);
    return () => {
      clearTimeout(timer);
    };
  },
};
export class DownloadQueueError extends Error {
  constructor(
    readonly code: 'queue_full' | 'closed' | 'invalid_policy' | 'wait_timeout' | 'duplicate',
  ) {
    super(`Download queue: ${code}`);
  }
}
function policy(input: DownloadQueuePolicy) {
  const bounded = (value: number | undefined, fallback: number, min: number, max: number) => {
    const n = value ?? fallback;
    if (!Number.isSafeInteger(n) || n < min || n > max)
      throw new DownloadQueueError('invalid_policy');
    return n;
  };
  return {
    concurrency: bounded(input.concurrency, 2, 1, 8),
    maxEntries: bounded(input.maxEntries, 64, 1, 256),
    startIntervalMs: bounded(input.startIntervalMs, 250, 0, 60_000),
    queueTimeoutMs: bounded(input.queueTimeoutMs, 300_000, 1, 1_800_000),
  };
}
interface Entry {
  readonly job: DownloadJob;
  state: DownloadState;
  readyAt: number;
  bytes: number;
  retry: DownloadSnapshot['retry'];
  error: unknown;
  controller?: AbortController;
  work?: Promise<void>;
  resumeRequested?: boolean;
  cancelled?: boolean;
}
const terminal = (state: DownloadState) => ['completed', 'cancelled', 'failed'].includes(state);

/** Bounded client-side scheduler. One slot covers the full stream, retries and local commit. */
export class DownloadQueue {
  private policy;
  private readonly entries = new Map<string, Entry>();
  private readonly listeners = new Set<() => void>();
  private active = 0;
  private lastStart = -Infinity;
  private held = false;
  private clearing = 0;
  private closed = false;
  private notification = false;
  private timer: (() => void) | undefined;
  constructor(
    options: DownloadQueuePolicy = {},
    private readonly time: DownloadQueueClock = clock,
  ) {
    this.policy = policy(options);
  }
  get snapshot(): readonly DownloadSnapshot[] {
    return [...this.entries.values()].map((e) => ({
      id: e.job.id,
      state: e.state,
      bytes: e.bytes,
      retry: e.retry ? { ...e.retry } : null,
      error: e.error,
      resumable: !e.cancelled && !e.work && ['paused', 'failed'].includes(e.state),
    }));
  }
  get paused() {
    return this.held;
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private changed() {
    if (this.notification) return;
    this.notification = true;
    queueMicrotask(() => {
      this.notification = false;
      for (const listener of this.listeners) {
        try {
          listener();
        } catch {
          /* Observers cannot break transfer accounting. */
        }
      }
    });
  }
  configure(options: DownloadQueuePolicy): void {
    const next = policy({ ...this.policy, ...options });
    if (next.maxEntries < this.entries.size) throw new DownloadQueueError('invalid_policy');
    this.policy = next;
    this.pump();
  }
  enqueue(job: DownloadJob): void {
    this.insert(job, false, 0);
  }
  /** Restored jobs never start until explicitly resumed with current credentials/destination. */
  restore(job: DownloadJob, bytes = 0): void {
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new DownloadQueueError('invalid_policy');
    this.insert(job, true, bytes);
  }
  private insert(job: DownloadJob, paused: boolean, bytes: number): void {
    if (this.closed) throw new DownloadQueueError('closed');
    if (!job.id || this.entries.has(job.id)) throw new DownloadQueueError('duplicate');
    if (this.entries.size >= this.policy.maxEntries) throw new DownloadQueueError('queue_full');
    this.entries.set(job.id, {
      job,
      state: paused ? 'paused' : 'queued',
      readyAt: this.time.now(),
      bytes,
      retry: null,
      error: undefined,
    });
    this.pump();
  }
  pause(id: string): boolean {
    const e = this.entries.get(id);
    if (!e) return false;
    delete e.resumeRequested;
    if (e.state === 'pausing') return true;
    if (e.state === 'queued') e.state = 'paused';
    else if (e.state === 'running' || e.state === 'retrying') {
      e.state = 'pausing';
      e.controller?.abort();
    } else return false;
    this.pump();
    return true;
  }
  resume(id: string): boolean {
    if (this.closed) return false;
    const e = this.entries.get(id);
    if (!e || e.cancelled || e.work || !['paused', 'failed'].includes(e.state)) return false;
    e.state = 'queued';
    e.readyAt = this.time.now();
    e.error = undefined;
    e.retry = null;
    // Explicit resume joins the tail; repeatedly paused jobs cannot jump the queue.
    this.entries.delete(id);
    this.entries.set(id, e);
    this.pump();
    return true;
  }
  pauseAll(): void {
    this.held = true;
    for (const id of this.entries.keys()) this.pause(id);
    this.pump();
  }
  resumeAll(eligibleIds?: ReadonlySet<string>): void {
    if (this.closed) return;
    this.held = false;
    for (const e of [...this.entries.values()]) {
      if (eligibleIds && !eligibleIds.has(e.job.id)) continue;
      if (e.state === 'paused') this.resume(e.job.id);
      else if (e.state === 'pausing') e.resumeRequested = true;
    }
    this.pump();
  }
  async cancel(id: string): Promise<boolean> {
    const e = this.entries.get(id);
    if (!e || e.state === 'saving' || e.state === 'completed' || e.state === 'cancelled')
      return false;
    if (e.state === 'cancelling') {
      await e.work;
      return true;
    }
    e.state = 'cancelling';
    e.cancelled = true;
    delete e.resumeRequested;
    e.controller?.abort();
    if (e.work) await e.work;
    else {
      const work = this.discard(e);
      e.work = work;
      await work;
      delete e.work;
    }
    this.pump();
    return true;
  }
  /** Cancel queued/paused jobs only. Active downloads and final files are untouched. */
  async clearWaiting(): Promise<void> {
    const ids = [...this.entries.values()]
      .filter((e) => e.state === 'queued' || e.state === 'paused')
      .map((e) => e.job.id);
    // Mark all before yielding, so releasing an active slot cannot start a selected job.
    await Promise.all(ids.map((id) => this.cancel(id)));
  }
  async cancelAll(): Promise<void> {
    this.clearing++;
    try {
      await Promise.all([...this.entries.keys()].map((id) => this.cancel(id)));
      await Promise.all([...this.entries.values()].flatMap((e) => (e.work ? [e.work] : [])));
    } finally {
      this.clearing--;
      this.pump();
    }
  }
  async remove(id: string): Promise<boolean> {
    const e = this.entries.get(id);
    if (!e || e.work || !terminal(e.state)) return false;
    // Reserve the entry during cleanup so resume/remove cannot race the destination.
    const prior = e.state;
    const work = Promise.resolve().then(() => e.job.discard());
    e.work = work;
    try {
      await work;
      this.entries.delete(id);
    } catch (error) {
      e.state = prior;
      e.error = error;
      return false;
    } finally {
      delete e.work;
      this.changed();
    }
    return true;
  }
  async clearFinished(): Promise<void> {
    await Promise.all(
      [...this.entries.values()].filter((e) => terminal(e.state)).map((e) => this.remove(e.job.id)),
    );
  }
  async close(): Promise<void> {
    this.closed = true;
    this.timer?.();
    this.timer = undefined;
    await this.cancelAll();
    await Promise.all([...this.entries.values()].flatMap((e) => (e.work ? [e.work] : [])));
  }
  private async discard(e: Entry) {
    try {
      await e.job.discard();
      e.state = 'cancelled';
      e.error = undefined;
    } catch (error) {
      e.state = 'failed';
      e.error = error;
    }
  }
  private pump() {
    this.timer?.();
    this.timer = undefined;
    const now = this.time.now();
    if (!this.closed && !this.held && this.clearing === 0) {
      for (const e of this.entries.values()) {
        if (e.state !== 'queued') continue;
        if (now - e.readyAt >= this.policy.queueTimeoutMs) {
          e.state = 'failed';
          e.error = new DownloadQueueError('wait_timeout');
        } else if (
          this.active < this.policy.concurrency &&
          now >= this.lastStart + this.policy.startIntervalMs
        ) {
          this.start(e);
        }
      }
      const waiting = [...this.entries.values()].filter((e) => e.state === 'queued');
      if (waiting.length) {
        let next = Math.min(...waiting.map((e) => e.readyAt + this.policy.queueTimeoutMs));
        if (this.active < this.policy.concurrency)
          next = Math.min(next, this.lastStart + this.policy.startIntervalMs);
        this.timer = this.time.schedule(
          () => {
            this.pump();
          },
          Math.max(1, next - now),
        );
      }
    }
    this.changed();
  }
  private start(e: Entry) {
    const controller = new AbortController();
    e.controller = controller;
    e.state = 'running';
    e.retry = null;
    this.active++;
    this.lastStart = this.time.now();
    // Defer user code until work is registered, including synchronous exceptions.
    e.work = Promise.resolve().then(async () => {
      try {
        controller.signal.throwIfAborted();
        await e.job.run({
          signal: controller.signal,
          progress: (bytes) => {
            if (!Number.isSafeInteger(bytes) || bytes < 0)
              throw new Error('Invalid download progress');
            e.bytes = bytes;
            if (e.state === 'retrying') e.state = 'running';
            e.retry = null;
            this.changed();
          },
          retry: (event) => {
            if (e.state === 'running' || e.state === 'retrying') {
              e.state = 'retrying';
              e.retry = { ...event };
              this.changed();
            }
          },
          beginCommit: () => {
            controller.signal.throwIfAborted();
            e.state = 'saving';
            this.changed();
          },
        });
        if (e.state !== 'saving') controller.signal.throwIfAborted();
        e.state = 'completed';
        // A committed file stays successful even if temporary-file cleanup needs another try.
        try {
          await e.job.discard();
        } catch (error) {
          e.error = error;
        }
      } catch (error) {
        if (e.state === 'pausing' && error === controller.signal.reason) e.state = 'paused';
        else if (e.state !== 'cancelling') {
          e.state = 'failed';
          e.error = error;
        }
      } finally {
        if (e.state === 'cancelling') await this.discard(e);
        delete e.controller;
        delete e.work;
        this.active--;
        if (e.state === 'paused' && e.resumeRequested) {
          delete e.resumeRequested;
          this.resume(e.job.id);
        }
        this.pump();
      }
    });
  }
}
