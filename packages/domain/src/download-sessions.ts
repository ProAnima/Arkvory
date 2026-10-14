import { ArkvoryError } from './artifact.js';
import {
  downloadCheckDelay,
  downloadNoShowAfter,
  estimateDownloadStarts,
  orderWaitingDownloads,
  MIN_DOWNLOAD_CHECK_MS,
  type DownloadClass,
  type DownloadSchedulePolicy,
} from './download-schedule.js';

export interface DownloadSessionRequest {
  /** Who and what: principal, object and client address for sessions without a ticket. */
  readonly key: string;
  readonly principal: string;
  readonly class: DownloadClass;
  readonly size: number;
}

export type DownloadDecision =
  | { readonly state: 'active' }
  | {
      readonly state: 'queued';
      /** 1 is next. */
      readonly position: number;
      /** Epoch milliseconds of the clock passed in; absent until a rate is measured. */
      readonly startsAt?: number;
      readonly checkAt: number;
    };

interface Session {
  readonly key: string;
  readonly principal: string;
  readonly class: DownloadClass;
  readonly size: number;
  readonly seq: number;
  readonly queuedAt: number;
  state: 'waiting' | 'active';
  /** Responses streaming now; the place is freed only when none are. */
  inFlight: number;
  served: number;
  /** Waiting: no-show deadline. Active without responses: when its place is freed. */
  expiresAt: number;
  position: number;
  startsAt: number | undefined;
  checkAt: number;
}

const RATE_SECONDS = 60;

/**
 * Download sessions of one process (ADR 0076): a place covers a whole download, not one range.
 * Time comes from the caller, so the rules are deterministic; `plan` is the one scheduler tick
 * that frees idle places, drops no-shows, hands free places on and refreshes estimates. Every
 * structure is bounded by the policy; nothing here keeps a timer.
 */
export class DownloadSessions {
  private readonly sessions = new Map<string, Session>();
  private readonly perPrincipal = new Map<string, number>();
  /** Active places in total, outside the interactive reserve and per principal. */
  private active = 0;
  private shared = 0;
  private readonly activeOf = new Map<string, number>();
  private waitingCount = 0;
  private readonly waitingOf: Record<DownloadClass, number> = {
    interactive: 0,
    release: 0,
    bulk: 0,
    background: 0,
  };
  private seq = 0;
  private draining = false;
  /** Bytes served per second over the last minute, by second. */
  private readonly rate = new Map<number, number>();
  private readonly counters = { admitted: 0, queued: 0, completed: 0, noShows: 0, refused: 0 };
  constructor(private current: DownloadSchedulePolicy) {}

  get policy() {
    return this.current;
  }

  /** Takes effect from the next decision; active sessions keep their places. */
  configure(policy: DownloadSchedulePolicy) {
    this.current = policy;
  }

  /**
   * Admits a response of a session or tells when to come back. An `active` answer counts one
   * response in flight; the caller must call `end` exactly once for it.
   */
  request(request: DownloadSessionRequest, now: number): DownloadDecision {
    const known = this.sessions.get(request.key);
    if (known?.state === 'active') {
      known.inFlight++;
      return { state: 'active' };
    }
    if (known) return this.queued(known, now);
    if (this.draining) throw busy('Server is stopping; retry later', MIN_DOWNLOAD_CHECK_MS);
    const owned = this.perPrincipal.get(request.principal) ?? 0;
    if (
      this.sessions.size >= this.current.maxSessions ||
      owned >= this.current.maxSessionsPerPrincipal
    ) {
      this.counters.refused++;
      throw busy('Download queue is full', 60_000);
    }
    const session: Session = {
      ...request,
      seq: ++this.seq,
      queuedAt: now,
      state: 'waiting',
      inFlight: 0,
      served: 0,
      expiresAt: now,
      position: this.waitingCount + 1,
      startsAt: undefined,
      checkAt: now,
    };
    this.sessions.set(session.key, session);
    this.perPrincipal.set(session.principal, owned + 1);
    this.waitingCount++;
    this.waitingOf[session.class]++;
    // A free place goes to it at once when nobody else waits, even beyond its principal's share,
    // and to a person when no other person waits: the reserve is theirs.
    const first =
      this.waitingCount === 1 ||
      (session.class === 'interactive' && this.waitingOf.interactive === 1);
    if (first && this.placeFor(session, false)) {
      this.activate(session, now);
      session.inFlight++;
      return { state: 'active' };
    }
    this.counters.queued++;
    session.checkAt = now + downloadCheckDelay(undefined, session.position, session.seq);
    return this.queued(session, now);
  }

  /** Bytes delivered for an active session; feeds the measured rate and its remaining size. */
  progress(key: string, bytes: number, now: number) {
    const session = this.sessions.get(key);
    if (session) session.served += bytes;
    const at = Math.floor(now / 1000);
    this.rate.set(at, (this.rate.get(at) ?? 0) + bytes);
    if (this.rate.size > RATE_SECONDS) this.forgetRate(at);
  }

  /** A response ended. Reaching the last byte with nothing else in flight completes the session. */
  end(key: string, reachedEnd: boolean, now: number) {
    const session = this.sessions.get(key);
    if (session?.state !== 'active' || session.inFlight === 0) return;
    session.inFlight--;
    session.expiresAt = now + this.current.idleMs;
    if (reachedEnd && session.inFlight === 0) {
      this.counters.completed++;
      this.remove(session);
    }
  }

  /** The scheduler tick: frees idle places, drops no-shows, fills places, refreshes estimates. */
  plan(now: number) {
    for (const session of this.sessions.values())
      if (session.inFlight === 0 && now > session.expiresAt) {
        if (session.state === 'waiting' || session.served === 0) this.counters.noShows++;
        this.remove(session);
      }
    const order = orderWaitingDownloads(
      [...this.sessions.values()].filter((session) => session.state === 'waiting'),
      this.current,
      now,
    );
    const placed = new Set<Session>();
    for (const strict of [true, false])
      for (const session of order)
        if (!placed.has(session) && this.placeFor(session, strict)) {
          this.activate(session, now);
          placed.add(session);
        }
    this.estimate(
      order.filter((session) => !placed.has(session)),
      now,
    );
  }

  /** New sessions are refused; active ones finish, waiting ones are told to come back. */
  drain() {
    this.draining = true;
  }

  snapshot(now: number) {
    const waiting = { ...this.waitingOf };
    return {
      strategy: this.current.strategy,
      capacity: this.current.slots,
      active: this.active,
      waiting,
      bytesPerSecond: Math.round(this.bytesPerSecond(now)),
      ...this.counters,
    };
  }

  get idle() {
    return this.sessions.size === 0;
  }

  private queued(session: Session, now: number): DownloadDecision {
    const delay = Math.max(MIN_DOWNLOAD_CHECK_MS, session.checkAt - now);
    // A told client is expected back by then; it keeps its place until that deadline.
    session.expiresAt = Math.max(session.expiresAt, now + downloadNoShowAfter(delay));
    return {
      state: 'queued',
      position: session.position,
      ...(session.startsAt === undefined ? {} : { startsAt: session.startsAt }),
      checkAt: now + delay,
    };
  }

  /**
   * Whether a place is free for this session: within the slots, outside the interactive reserve
   * unless it is interactive, and, when `strict`, within its principal's share.
   */
  private placeFor(session: Session, strict: boolean) {
    if (this.active >= this.current.slots) return false;
    if (
      session.class !== 'interactive' &&
      this.shared >= this.current.slots - this.current.interactiveReserve
    )
      return false;
    return !strict || (this.activeOf.get(session.principal) ?? 0) < this.current.perPrincipalActive;
  }

  private activate(session: Session, now: number) {
    session.state = 'active';
    this.waitingCount--;
    this.waitingOf[session.class]--;
    this.active++;
    if (session.class !== 'interactive') this.shared++;
    this.activeOf.set(session.principal, (this.activeOf.get(session.principal) ?? 0) + 1);
    this.counters.admitted++;
    // A promoted client is not connected: the place waits for it until its no-show deadline.
    session.expiresAt = Math.max(session.expiresAt, now + this.current.idleMs);
  }

  private estimate(waiting: Session[], now: number) {
    const remaining: number[] = [];
    for (const session of this.sessions.values())
      if (session.state === 'active') remaining.push(Math.max(0, session.size - session.served));
    const starts = estimateDownloadStarts(
      remaining,
      waiting.map((session) => session.size),
      this.current.slots - this.current.interactiveReserve,
      this.bytesPerSecond(now),
    );
    waiting.forEach((session, index) => {
      const startsIn = starts[index];
      session.position = index + 1;
      session.startsAt = startsIn === undefined ? undefined : now + startsIn;
      session.checkAt = now + downloadCheckDelay(startsIn, session.position, session.seq);
    });
  }

  /** Bytes per second over the last minute, from the first second with traffic in it. */
  private bytesPerSecond(now: number) {
    const at = Math.floor(now / 1000);
    this.forgetRate(at);
    let total = 0;
    let oldest = at;
    for (const [stamp, bytes] of this.rate) {
      total += bytes;
      oldest = Math.min(oldest, stamp);
    }
    return total / (at - oldest + 1);
  }

  private forgetRate(at: number) {
    for (const stamp of this.rate.keys()) if (stamp <= at - RATE_SECONDS) this.rate.delete(stamp);
  }

  private remove(session: Session) {
    this.sessions.delete(session.key);
    if (session.state === 'waiting') {
      this.waitingCount--;
      this.waitingOf[session.class]--;
    } else {
      this.active--;
      if (session.class !== 'interactive') this.shared--;
      const own = (this.activeOf.get(session.principal) ?? 1) - 1;
      if (own === 0) this.activeOf.delete(session.principal);
      else this.activeOf.set(session.principal, own);
    }
    const owned = (this.perPrincipal.get(session.principal) ?? 1) - 1;
    if (owned === 0) this.perPrincipal.delete(session.principal);
    else this.perPrincipal.set(session.principal, owned);
  }
}

function busy(message: string, retryMs: number) {
  return new ArkvoryError('busy', message, { retryAfterSeconds: Math.ceil(retryMs / 1000) });
}
