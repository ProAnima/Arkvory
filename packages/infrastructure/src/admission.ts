import { ArkvoryError } from '@proanima/arkvory-domain';

/** The clock and randomness of an estimate; tests pass fixed ones. */
export interface AdmissionClock {
  now(): number;
  random(): number;
}
const systemClock: AdmissionClock = { now: () => performance.now(), random: Math.random };
/** Releases remembered for the rate: enough for a stable estimate, bounded memory. */
const RATE_SAMPLES = 256;
/** Only the last minute counts: releases from an idle hour ago would make the rate look slow. */
const RATE_WINDOW_MS = 60000;
/** A refused client comes back no sooner than this and no later than this (seconds). */
const MIN_RETRY_SECONDS = 2;
const MAX_RETRY_SECONDS = 600;

interface Waiter {
  owner: string;
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
}
/** Bounded, per-owner round-robin admission for a single gateway. */
export class AdmissionQueue {
  private active = 0;
  private readonly activeOwners = new Map<string, number>();
  private closed = false;
  private draining = false;
  private rejected = 0;
  private timedOut = 0;
  private cancelled = 0;
  private lastOwner = '';
  private readonly waiting: Waiter[] = [];
  /** Times of the latest releases, oldest first: the rate at which places free up. */
  private readonly releases: number[] = [];
  constructor(
    private readonly slots: number,
    private readonly maxWaiting = 64,
    private readonly perOwner = 8,
    private readonly timeoutMs = 20000,
    private readonly maxActivePerOwner = slots,
    private readonly clock: AdmissionClock = systemClock,
  ) {
    if (
      [slots, maxWaiting, perOwner, timeoutMs, maxActivePerOwner].some(
        (value) => !Number.isSafeInteger(value) || value < 1,
      ) ||
      maxActivePerOwner > slots ||
      perOwner > maxWaiting ||
      maxWaiting > 1024 ||
      timeoutMs > 120000
    )
      throw new Error('Invalid admission capacity');
  }
  get snapshot() {
    return {
      active: this.active,
      waiting: this.waiting.length,
      capacity: this.slots,
      perPrincipalCapacity: this.maxActivePerOwner,
      waitingCapacity: this.maxWaiting,
      perPrincipalWaitingCapacity: this.perOwner,
      timeoutMs: this.timeoutMs,
      rejected: this.rejected,
      timedOut: this.timedOut,
      cancelled: this.cancelled,
    };
  }
  async acquire(owner: string, signal?: AbortSignal): Promise<() => void> {
    signal?.throwIfAborted();
    if (this.closed) throw new ArkvoryError('unavailable', 'Gateway is closing');
    if (this.draining) {
      this.rejected++;
      throw new ArkvoryError('busy', 'Gateway is draining; retry later', {
        retryAfterSeconds: MIN_RETRY_SECONDS,
      });
    }
    if (this.active < this.slots && this.waiting.length === 0 && this.ownerAvailable(owner)) {
      this.activate(owner);
      this.lastOwner = owner;
      return this.release(owner);
    }
    if (
      this.waiting.length >= this.maxWaiting ||
      this.waiting.filter((item) => item.owner === owner).length >= this.perOwner
    ) {
      this.rejected++;
      throw new ArkvoryError('busy', 'Transfer queue is full', {
        retryAfterSeconds: this.retryAfterSeconds(),
      });
    }
    return new Promise((resolve, reject) => {
      // The error is made once the waiter has left: its Retry-After counts it once, not twice.
      const remove = (error: () => Error) => {
        const index = this.waiting.indexOf(waiter);
        if (index >= 0) this.waiting.splice(index, 1);
        waiter.cleanup();
        reject(error());
      };
      const abort = () => {
        this.cancelled++;
        remove(() => new ArkvoryError('busy', 'Transfer request aborted'));
      };
      const timer = setTimeout(() => {
        this.timedOut++;
        remove(
          () =>
            new ArkvoryError('busy', 'Transfer admission timed out', {
              retryAfterSeconds: this.retryAfterSeconds(),
            }),
        );
      }, this.timeoutMs);
      const waiter: Waiter = {
        owner,
        resolve,
        reject,
        cleanup: () => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', abort);
        },
      };
      signal?.addEventListener('abort', abort, { once: true });
      this.waiting.push(waiter);
      this.dispatch();
    });
  }
  private ownerAvailable(owner: string) {
    return (this.activeOwners.get(owner) ?? 0) < this.maxActivePerOwner;
  }
  private activate(owner: string) {
    this.active++;
    this.activeOwners.set(owner, (this.activeOwners.get(owner) ?? 0) + 1);
  }
  private dispatch() {
    while (!this.closed && this.active < this.slots && this.waiting.length) {
      let candidate = this.waiting.findIndex(
        (item) => item.owner !== this.lastOwner && this.ownerAvailable(item.owner),
      );
      if (candidate < 0)
        candidate = this.waiting.findIndex((item) => this.ownerAvailable(item.owner));
      if (candidate < 0) return;
      const next = this.waiting.splice(candidate, 1)[0];
      if (!next) return;
      next.cleanup();
      this.activate(next.owner);
      this.lastOwner = next.owner;
      next.resolve(this.release(next.owner));
    }
  }
  private release(owner: string) {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      this.releases.push(this.clock.now());
      if (this.releases.length > RATE_SAMPLES) this.releases.shift();
      const count = (this.activeOwners.get(owner) ?? 1) - 1;
      if (count === 0) this.activeOwners.delete(owner);
      else this.activeOwners.set(owner, count);
      this.dispatch();
    };
  }
  /**
   * When a refused request should come back (ADR 0076): the requests already waiting, plus this
   * one, divided by the measured rate at which places free up, so a long queue sends clients
   * away for longer instead of every two seconds. Up to a quarter more at random spreads
   * clients that do not add their own jitter. Without releases in the last minute, one wait
   * timeout.
   */
  retryAfterSeconds(): number {
    const now = this.clock.now();
    while (this.releases[0] !== undefined && now - this.releases[0] > RATE_WINDOW_MS)
      this.releases.shift();
    const oldest = this.releases[0];
    const span = oldest === undefined ? 0 : (now - oldest) / 1000;
    const perSecond = span >= 1 ? this.releases.length / span : 0;
    const ahead = this.waiting.length + 1;
    const estimate = perSecond > 0 ? ahead / perSecond : this.timeoutMs / 1000;
    const spread = estimate * (1 + this.clock.random() / 4);
    return Math.ceil(Math.min(MAX_RETRY_SECONDS, Math.max(MIN_RETRY_SECONDS, spread)));
  }
  /** Rejects queued and future admissions; active slots finish and release normally. */
  drain() {
    this.draining = true;
    for (const waiter of this.waiting.splice(0)) {
      waiter.cleanup();
      this.rejected++;
      waiter.reject(
        new ArkvoryError('busy', 'Gateway is draining; retry later', {
          retryAfterSeconds: MIN_RETRY_SECONDS,
        }),
      );
    }
  }
  get idle(): boolean {
    return this.active === 0 && this.waiting.length === 0;
  }
  close() {
    this.closed = true;
    for (const waiter of this.waiting.splice(0)) {
      waiter.cleanup();
      waiter.reject(new ArkvoryError('unavailable', 'Gateway is closing'));
    }
  }
}
