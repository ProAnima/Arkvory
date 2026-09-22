import { DepotError } from '@proanima/depot-domain';

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
  private rejected = 0;
  private timedOut = 0;
  private cancelled = 0;
  private lastOwner = '';
  private readonly waiting: Waiter[] = [];
  constructor(
    private readonly slots: number,
    private readonly maxWaiting = 64,
    private readonly perOwner = 8,
    private readonly timeoutMs = 20000,
    private readonly maxActivePerOwner = slots,
  ) {
    if (
      [slots, maxWaiting, perOwner, timeoutMs, maxActivePerOwner].some(
        (value) => !Number.isSafeInteger(value) || value < 1,
      ) ||
      maxActivePerOwner > slots
    )
      throw new Error('Invalid admission capacity');
  }
  get snapshot() {
    return {
      active: this.active,
      waiting: this.waiting.length,
      capacity: this.slots,
      perPrincipalCapacity: this.maxActivePerOwner,
      rejected: this.rejected,
      timedOut: this.timedOut,
      cancelled: this.cancelled,
    };
  }
  async acquire(owner: string, signal?: AbortSignal): Promise<() => void> {
    signal?.throwIfAborted();
    if (this.closed) throw new DepotError('unavailable', 'Gateway is closing');
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
      throw new DepotError('busy', 'Transfer queue is full');
    }
    return new Promise((resolve, reject) => {
      const remove = (error: Error) => {
        const index = this.waiting.indexOf(waiter);
        if (index >= 0) this.waiting.splice(index, 1);
        waiter.cleanup();
        reject(error);
      };
      const abort = () => {
        this.cancelled++;
        remove(new DepotError('busy', 'Transfer request aborted'));
      };
      const timer = setTimeout(() => {
        this.timedOut++;
        remove(new DepotError('busy', 'Transfer admission timed out'));
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
      const count = (this.activeOwners.get(owner) ?? 1) - 1;
      if (count === 0) this.activeOwners.delete(owner);
      else this.activeOwners.set(owner, count);
      this.dispatch();
    };
  }
  close() {
    this.closed = true;
    for (const waiter of this.waiting.splice(0)) {
      waiter.cleanup();
      waiter.reject(new DepotError('unavailable', 'Gateway is closing'));
    }
  }
}
