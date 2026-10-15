import {
  DownloadSessions,
  type DownloadByteRange,
  type DownloadDecision,
  type DownloadResponseEnd,
  type DownloadSchedulePolicy,
  type DownloadSessionRequest,
} from '@proanima/arkvory-domain';
import type { DownloadTickets } from './download-tickets.js';

/**
 * One response of an active session; `end` is idempotent. `finished`: the whole range asked for
 * was sent; only then do its bytes count for the download's completion.
 */
export interface DownloadLease {
  progress(bytes: number): void;
  end(how: Omit<DownloadResponseEnd, 'range'>): void;
}
/** `ticket`: the queue ticket the client should send back, when tickets are on. */
export type DownloadAdmission = (
  | { readonly state: 'active'; readonly lease: DownloadLease }
  | Exclude<DownloadDecision, { state: 'active' }>
) & { readonly ticket?: string };

/** A request with the queue ticket the client sent, if any. */
export type TicketedRequest = DownloadSessionRequest & { readonly ticket?: string };

/** Scheduler tick: frequent enough for prompt hand-over, rare enough to cost nothing. */
const TICK_MS = 500;

/**
 * Epoch milliseconds that never step back or jump with the wall clock: deadlines and aging must
 * not shift when NTP or a VM host corrects the time.
 */
const monotonic = () => performance.timeOrigin + performance.now();

/**
 * The in-process download scheduler (ADR 0076): the session rules of the domain driven by one
 * timer for all sessions. It can also hold a request of a client that does not follow the queue
 * protocol (docker, npm, a browser) until its turn, within a time limit and a bounded number of
 * held requests, since such clients often give up on 503.
 */
export class DownloadScheduler {
  private readonly sessions: DownloadSessions;
  private readonly timer: ReturnType<typeof setInterval>;
  private readonly ticks = new Set<() => void>();
  private held = 0;
  private closed = false;
  private tickMs = 0;
  private tickets: DownloadTickets | undefined;
  constructor(
    policy: DownloadSchedulePolicy,
    private readonly hold: { readonly limit: number; readonly timeoutMs: number } = {
      limit: 64,
      timeoutMs: 20000,
    },
    private readonly now: () => number = monotonic,
    /** Wall-clock epoch milliseconds: tickets and Arkvory-Starts-At speak it. */
    private readonly wall: () => number = Date.now,
  ) {
    this.sessions = new DownloadSessions(policy);
    this.timer = setInterval(() => {
      this.plan();
    }, TICK_MS);
    this.timer.unref();
  }

  get policy() {
    return this.sessions.policy;
  }

  configure(policy: DownloadSchedulePolicy) {
    this.sessions.configure(policy);
  }

  /** Signs and reads queue tickets from now on; without it there are none. */
  useTickets(tickets: DownloadTickets) {
    this.tickets = tickets;
  }

  admit(request: TicketedRequest): DownloadAdmission {
    const { ticket, ...session } = request;
    const arrivedAt = this.tickets?.read(session.key, ticket, this.wall());
    const decision = this.sessions.request(
      arrivedAt === undefined
        ? session
        : { ...session, arrivedAt: this.now() - (this.wall() - arrivedAt) },
      this.now(),
    );
    const range = session.range ?? { start: 0, end: session.size - 1, open: true };
    const admission = decision.state === 'active' ? this.lease(session.key, range) : decision;
    const arrival = this.sessions.arrivalOf(session.key);
    // Re-issued on every answer with the same arrival: a ticket is accepted only shortly after
    // its issue, so a client waiting for days keeps its turn through the fresh ones.
    return this.tickets && arrival !== undefined
      ? {
          ...admission,
          ticket: this.tickets.issue(session.key, this.wallClock(arrival), this.wall()),
        }
      : admission;
  }

  /**
   * Admits like `admit`, but a queued request waits here, rechecking on every tick, until it
   * gets its place, the hold time ends or the signal aborts. Beyond the held-request limit, or
   * without a hold time, it answers at once.
   */
  async admitHeld(request: TicketedRequest, signal: AbortSignal): Promise<DownloadAdmission> {
    let admission = this.admit(request);
    if (admission.state === 'active' || this.held >= this.hold.limit) return admission;
    const until = this.now() + this.hold.timeoutMs;
    this.held++;
    try {
      // Settings changed while held (stage 3): an object no longer queued leaves at once, and the
      // caller admits it per request.
      const queued = () =>
        this.policy.strategy !== 'shared' && request.size > this.policy.sessionMinBytes;
      while (admission.state !== 'active' && !this.closed && this.now() < until && queued()) {
        await this.nextTick(signal);
        admission = this.admit(request);
      }
      return admission;
    } finally {
      this.held--;
    }
  }

  /** Runs one tick now; tests and shutdown use it instead of waiting for the timer. */
  plan() {
    const started = performance.now();
    this.sessions.plan(this.now());
    this.tickMs = performance.now() - started;
    for (const wake of [...this.ticks]) wake();
  }

  /** Milliseconds from now to a time of this scheduler's clock. */
  until(at: number) {
    return at - this.now();
  }

  /** Converts a time of this scheduler's clock to wall-clock epoch milliseconds. */
  wallClock(at: number) {
    return this.wall() + (at - this.now());
  }

  get snapshot() {
    const policy = this.sessions.policy;
    return {
      ...this.sessions.snapshot(this.now()),
      held: this.held,
      tickMilliseconds: Math.round(this.tickMs * 10) / 10,
      settings: {
        strategy: policy.strategy,
        sessions: policy.slots,
        reserve: policy.interactiveReserve,
        perPrincipal: policy.perPrincipalActive,
        weights: policy.weights,
        sessionMinBytes: policy.sessionMinBytes,
        idleSeconds: policy.idleMs / 1000,
        agingMinutes: policy.agingMs / 60000,
        preempt: policy.preempt,
        rangesPerSession: policy.rangesPerSession,
        queueLimit: policy.maxSessions,
        queuePerPrincipal: policy.maxSessionsPerPrincipal,
        holdSeconds: this.hold.timeoutMs / 1000,
      },
    };
  }

  drain() {
    this.sessions.drain();
  }

  close() {
    this.closed = true;
    clearInterval(this.timer);
    for (const wake of [...this.ticks]) wake();
  }

  private lease(key: string, range: DownloadByteRange): DownloadAdmission {
    let ended = false;
    return {
      state: 'active',
      lease: {
        progress: (bytes) => {
          if (!ended) this.sessions.progress(key, bytes, this.now());
        },
        end: (how) => {
          if (ended) return;
          ended = true;
          this.sessions.end(key, { finished: how.finished, range }, this.now());
        },
      },
    };
  }

  private nextTick(signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      const done = () => {
        this.ticks.delete(done);
        signal.removeEventListener('abort', abort);
        resolve();
      };
      const abort = () => {
        this.ticks.delete(done);
        reject(signal.reason instanceof Error ? signal.reason : new Error('Aborted'));
      };
      if (signal.aborted) {
        abort();
        return;
      }
      this.ticks.add(done);
      signal.addEventListener('abort', abort, { once: true });
    });
  }
}
