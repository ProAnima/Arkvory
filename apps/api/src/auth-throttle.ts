import { isIP } from 'node:net';

/** One token returns every `refillMs`; `capacity` bounds the burst. */
export interface BucketPolicy {
  readonly capacity: number;
  readonly refillMs: number;
}
export interface AuthThrottlePolicy {
  readonly login: BucketPolicy;
  readonly registration: BucketPolicy;
  readonly registrationTotal: BucketPolicy;
  readonly maxAddresses: number;
}
/**
 * Per-address login refill (4/min) stays below the account backoff drain (10/min), so a single
 * address cannot hold an account in backoff even when two writer processes each admit it.
 */
export const AUTH_THROTTLE: AuthThrottlePolicy = {
  login: { capacity: 10, refillMs: 15_000 },
  registration: { capacity: 3, refillMs: 20 * 60_000 },
  registrationTotal: { capacity: 20, refillMs: 3 * 60_000 },
  maxAddresses: 10_000,
};

interface Bucket {
  tokens: number;
  at: number;
}

/** Bounded per-key token buckets; state is per process and resets on restart. */
export class TokenBuckets {
  private readonly buckets = new Map<string, Bucket>();
  constructor(
    private readonly policy: BucketPolicy,
    private readonly now: () => number,
    private readonly maxKeys: number,
  ) {}
  private level(bucket: Bucket | undefined, now: number): number {
    if (!bucket) return this.policy.capacity;
    const refilled = Math.max(0, now - bucket.at) / this.policy.refillMs;
    return Math.min(this.policy.capacity, bucket.tokens + refilled);
  }
  /** Zero when admitted; otherwise whole seconds until the next token. A refusal costs nothing. */
  take(key: string): number {
    const now = this.now();
    const tokens = this.level(this.buckets.get(key), now);
    if (tokens < 1) return Math.max(1, Math.ceil(((1 - tokens) * this.policy.refillMs) / 1000));
    this.store(key, { tokens: tokens - 1, at: now }, now);
    return 0;
  }
  refund(key: string): void {
    const bucket = this.buckets.get(key);
    if (bucket) bucket.tokens = Math.min(this.policy.capacity, bucket.tokens + 1);
  }
  get size(): number {
    return this.buckets.size;
  }
  private store(key: string, bucket: Bucket, now: number): void {
    // Re-insertion keeps Map order least-recently-used first.
    this.buckets.delete(key);
    this.buckets.set(key, bucket);
    if (this.buckets.size <= this.maxKeys) return;
    // A full bucket is indistinguishable from an absent one, so it is dropped first.
    for (const [candidate, value] of this.buckets) {
      if (this.buckets.size <= this.maxKeys) return;
      if (this.level(value, now) >= this.policy.capacity) this.buckets.delete(candidate);
    }
    for (const candidate of this.buckets.keys()) {
      if (this.buckets.size <= this.maxKeys) return;
      this.buckets.delete(candidate);
    }
  }
}

function ipv6Prefix(address: string): string {
  const [plain = ''] = address.split('%');
  const [head = '', tail] = plain.split('::');
  const width = (part: string) => (part.includes('.') ? 2 : 1);
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const used = [...left, ...right].reduce((sum, part) => sum + width(part), 0);
  const groups = [...left, ...Array.from({ length: Math.max(0, 8 - used) }, () => '0'), ...right];
  return (
    groups
      .slice(0, 4)
      .map((group) => Number.parseInt(group || '0', 16).toString(16))
      .join(':') + '::/64'
  );
}
/** Throttle key: IPv4 as is, IPv6 by /64 because one host usually controls a whole prefix. */
export function clientKey(address: string): string {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  if (mapped?.[1]) return mapped[1];
  return isIP(address) === 6 ? ipv6Prefix(address) : address;
}

/** Anonymous password endpoints are admitted here before any body validation cost or hashing. */
export class AuthThrottle {
  private readonly login: TokenBuckets;
  private readonly registration: TokenBuckets;
  private readonly registrationTotal: TokenBuckets;
  constructor(now: () => number, policy: AuthThrottlePolicy = AUTH_THROTTLE) {
    this.login = new TokenBuckets(policy.login, now, policy.maxAddresses);
    this.registration = new TokenBuckets(policy.registration, now, policy.maxAddresses);
    this.registrationTotal = new TokenBuckets(policy.registrationTotal, now, 1);
  }
  admitLogin(key: string): number {
    return this.login.take(key);
  }
  /** A correct password returns its token: only failures drain an address's budget. */
  loginSucceeded(key: string): void {
    this.login.refund(key);
  }
  admitRegistration(key: string): number {
    const wait = this.registration.take(key);
    if (wait) return wait;
    const total = this.registrationTotal.take('all');
    if (total) this.registration.refund(key);
    return total;
  }
}
