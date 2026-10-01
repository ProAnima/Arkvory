import { ArkvoryError } from '@proanima/arkvory-domain';

export interface BandwidthPolicy {
  readonly bytesPerSecond: number;
  readonly perPrincipalBytesPerSecond: number;
}

/** Monotonic time and one cancellable timer; replaceable by a virtual clock in tests. */
export interface BandwidthClock {
  now(): number;
  schedule(action: () => void, delayMs: number): () => void;
}
const clock: BandwidthClock = {
  now: () => performance.now(),
  schedule(action, delayMs) {
    const timer = setTimeout(action, delayMs);
    return () => {
      clearTimeout(timer);
    };
  },
};

interface Bucket {
  tokens: number;
  updated: number;
}
interface Waiter {
  readonly bytes: number;
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
  readonly cleanup: () => void;
}
function burst(rate: number) {
  return rate === 0 ? Infinity : Math.min(1024 ** 2, Math.floor(rate / 10));
}
function validateRate(rate: number) {
  if (!Number.isSafeInteger(rate) || (rate !== 0 && (rate < 65536 || rate > 1024 ** 4)))
    throw new Error('Bandwidth must be zero or 65536..1099511627776 bytes per second');
}

/** Shared per-direction token buckets. Principal identity, not connection count, owns a quota. */
export class BandwidthGovernor {
  private readonly global: Bucket;
  private readonly principals = new Map<string, Bucket>();
  private readonly queues = new Map<string, Waiter[]>();
  private readonly rotation: string[] = [];
  private pending = 0;
  private grantedBytes = 0n;
  private cancelTimer: (() => void) | undefined;
  private closed = false;
  readonly quantum: number;

  constructor(
    private readonly policy: BandwidthPolicy,
    owners: readonly string[],
    private readonly available: () => boolean = () => true,
    private readonly time: BandwidthClock = clock,
  ) {
    validateRate(policy.bytesPerSecond);
    validateRate(policy.perPrincipalBytesPerSecond);
    if (owners.length > 1000) throw new Error('Too many bandwidth principals');
    const now = time.now();
    this.global = { tokens: burst(policy.bytesPerSecond), updated: now };
    for (const owner of owners)
      this.principals.set(owner, {
        tokens: burst(policy.perPrincipalBytesPerSecond),
        updated: now,
      });
    this.quantum = Math.min(
      65536,
      burst(policy.bytesPerSecond),
      burst(policy.perPrincipalBytesPerSecond),
    );
  }

  register(owner: string): void {
    if (this.principals.has(owner)) return;
    if (this.principals.size >= 3000)
      throw new ArkvoryError('capacity_exceeded', 'Too many bandwidth principals', {
        reason: 'transfer_limit',
      });
    this.principals.set(owner, {
      tokens: burst(this.policy.perPrincipalBytesPerSecond),
      updated: this.time.now(),
    });
  }

  get snapshot() {
    return {
      ...this.policy,
      burstBytes: Number.isFinite(burst(this.policy.bytesPerSecond))
        ? burst(this.policy.bytesPerSecond)
        : 0,
      perPrincipalBurstBytes: Number.isFinite(burst(this.policy.perPrincipalBytesPerSecond))
        ? burst(this.policy.perPrincipalBytesPerSecond)
        : 0,
      waiting: this.pending,
      grantedBytes: this.grantedBytes.toString(),
    };
  }

  async *stream(
    source: AsyncIterable<Uint8Array>,
    owner: string,
    signal: AbortSignal,
  ): AsyncIterable<Uint8Array> {
    signal.throwIfAborted();
    this.checkAvailable();
    for await (const chunk of source) {
      for (let offset = 0; offset < chunk.byteLength; offset += this.quantum) {
        signal.throwIfAborted();
        const bytes = chunk.subarray(offset, Math.min(chunk.byteLength, offset + this.quantum));
        await this.acquire(owner, bytes.byteLength, signal);
        signal.throwIfAborted();
        this.checkAvailable();
        yield bytes;
      }
    }
    signal.throwIfAborted();
    this.checkAvailable();
  }

  private checkAvailable(): void {
    if (this.closed || !this.available())
      throw new ArkvoryError('unavailable', 'Gateway is unavailable');
  }

  async acquire(owner: string, bytes: number, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    this.checkAvailable();
    if (!this.principals.has(owner))
      throw new ArkvoryError('forbidden', 'Unknown bandwidth principal', {
        reason: 'permission_missing',
      });
    if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > this.quantum)
      throw new Error('Invalid byte quantum');
    if (this.pending >= 256) throw new ArkvoryError('busy', 'Bandwidth queue is full');
    return new Promise<void>((resolve, reject) => {
      const abort = () => {
        const queue = this.queues.get(owner);
        const index = queue?.indexOf(waiter) ?? -1;
        if (queue && index >= 0) {
          queue.splice(index, 1);
          this.pending--;
          waiter.cleanup();
          reject(new ArkvoryError('busy', 'Transfer request aborted'));
          this.pump();
        }
      };
      const waiter: Waiter = {
        bytes,
        resolve,
        reject,
        cleanup: () => {
          signal?.removeEventListener('abort', abort);
        },
      };
      let queue = this.queues.get(owner);
      if (!queue) {
        queue = [];
        this.queues.set(owner, queue);
        this.rotation.push(owner);
      }
      queue.push(waiter);
      this.pending++;
      signal?.addEventListener('abort', abort, { once: true });
      this.pump();
    });
  }

  private refill(bucket: Bucket, rate: number, now: number) {
    if (rate !== 0)
      bucket.tokens = Math.min(
        burst(rate),
        bucket.tokens + (Math.max(0, now - bucket.updated) * rate) / 1000,
      );
    bucket.updated = now;
  }

  private pump() {
    this.cancelTimer?.();
    this.cancelTimer = undefined;
    if (this.closed || !this.available()) {
      this.close();
      return;
    }
    let waitMs = Infinity;
    let examined = 0;
    const now = this.time.now();
    this.refill(this.global, this.policy.bytesPerSecond, now);
    while (this.rotation.length && examined < this.rotation.length) {
      const owner = this.rotation.shift();
      if (owner === undefined) break;
      const queue = this.queues.get(owner),
        bucket = this.principals.get(owner);
      const next = queue?.[0];
      if (!queue || !next || !bucket) {
        this.queues.delete(owner);
        continue;
      }
      this.rotation.push(owner);
      this.refill(bucket, this.policy.perPrincipalBytesPerSecond, now);
      const globalWait =
        this.policy.bytesPerSecond === 0
          ? 0
          : (Math.max(0, next.bytes - this.global.tokens) * 1000) / this.policy.bytesPerSecond;
      const ownerWait =
        this.policy.perPrincipalBytesPerSecond === 0
          ? 0
          : (Math.max(0, next.bytes - bucket.tokens) * 1000) /
            this.policy.perPrincipalBytesPerSecond;
      const needed = Math.max(globalWait, ownerWait);
      if (globalWait > 0 && ownerWait === 0) {
        // Keep this eligible principal at the head until its quantum fits. Otherwise
        // a stream of tiny chunks could consume every refill and starve larger chunks.
        this.rotation.pop();
        this.rotation.unshift(owner);
        waitMs = globalWait;
        break;
      }
      if (needed > 0) {
        waitMs = Math.min(waitMs, needed);
        examined++;
        continue;
      }
      queue.shift();
      this.pending--;
      this.global.tokens -= next.bytes;
      bucket.tokens -= next.bytes;
      this.grantedBytes += BigInt(next.bytes);
      next.cleanup();
      next.resolve();
      examined = 0;
      waitMs = Infinity;
    }
    if (this.pending > 0 && Number.isFinite(waitMs))
      this.cancelTimer = this.time.schedule(
        () => {
          this.cancelTimer = undefined;
          this.pump();
        },
        Math.max(1, Math.ceil(waitMs)),
      );
  }

  close() {
    this.closed = true;
    this.cancelTimer?.();
    this.cancelTimer = undefined;
    for (const queue of this.queues.values())
      for (const waiter of queue) {
        waiter.cleanup();
        waiter.reject(new ArkvoryError('unavailable', 'Gateway is unavailable'));
      }
    this.queues.clear();
    this.rotation.length = 0;
    this.pending = 0;
  }
}
