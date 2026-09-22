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
  private lastOwner = '';
  private readonly waiting: Waiter[] = [];
  constructor(
    private readonly slots: number,
    private readonly maxWaiting = 64,
    private readonly perOwner = 8,
    private readonly timeoutMs = 20000,
  ) {
    if (!Number.isSafeInteger(slots) || slots < 1) throw new Error('Invalid admission capacity');
  }
  get snapshot() {
    return { active: this.active, waiting: this.waiting.length, capacity: this.slots };
  }
  async acquire(owner: string, signal?: AbortSignal): Promise<() => void> {
    signal?.throwIfAborted();
    if (this.active < this.slots && this.waiting.length === 0) {
      this.active++;
      this.lastOwner = owner;
      return this.release();
    }
    if (
      this.waiting.length >= this.maxWaiting ||
      this.waiting.filter((item) => item.owner === owner).length >= this.perOwner
    )
      throw new DepotError('busy', 'Transfer queue is full');
    return new Promise((resolve, reject) => {
      const remove = (error: Error) => {
        const index = this.waiting.indexOf(waiter);
        if (index >= 0) this.waiting.splice(index, 1);
        waiter.cleanup();
        reject(error);
      };
      const abort = () => {
        remove(new DepotError('busy', 'Transfer request aborted'));
      };
      const timer = setTimeout(() => {
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
    });
  }
  private release() {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      if (this.waiting.length) {
        const candidate = this.waiting.findIndex((item) => item.owner !== this.lastOwner);
        const next = this.waiting.splice(candidate < 0 ? 0 : candidate, 1)[0];
        if (next) {
          next.cleanup();
          this.active++;
          this.lastOwner = next.owner;
          next.resolve(this.release());
        }
      }
    };
  }
  close() {
    for (const waiter of this.waiting.splice(0)) {
      waiter.cleanup();
      waiter.reject(new DepotError('unavailable', 'Gateway is closing'));
    }
  }
}
