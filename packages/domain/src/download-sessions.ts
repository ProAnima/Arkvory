import { ArkvoryError } from './artifact.js';
import {
  downloadClasses,
  type DownloadClass,
  type DownloadSchedulePolicy,
} from './download-policy.js';
import {
  downloadCheckDelay,
  downloadNoShowAfter,
  estimateDownloadStarts,
  orderWaitingDownloads,
  MIN_DOWNLOAD_CHECK_MS,
} from './download-schedule.js';
import { DownloadCoverage, type DownloadByteRange } from './download-coverage.js';
import { DownloadOccupancy } from './download-occupancy.js';
import { DownloadRate } from './download-rate.js';
import { DownloadResumes } from './download-resumes.js';

export interface DownloadSessionRequest {
  /** Who and what: principal, object, and the client's download id or else its address. */
  readonly key: string;
  readonly principal: string;
  readonly class: DownloadClass;
  readonly size: number;
  /** The client sent its own download id: it follows the queue protocol and may yield. */
  readonly queueAware: boolean;
  /**
   * When this download first came, from a verified queue ticket after a restart: it takes its
   * old turn. The caller checks the ticket; a time in the future is taken as now.
   */
  readonly arrivedAt?: number;
  /** The bytes this response asks for; absent: the whole object. */
  readonly range?: DownloadByteRange;
}

export type DownloadDecision =
  | { readonly state: 'active' }
  | {
      readonly state: 'queued';
      /** 1 is next; absent until the next tick placed a new session. */
      readonly position?: number;
      /** Clock of the caller; absent until a rate is measured. Never in the past. */
      readonly startsAt?: number;
      readonly checkAt: number;
    };

/** How a response ended: `finished` when all of `range` was sent; its bytes then count. */
export interface DownloadResponseEnd {
  readonly finished: boolean;
  readonly range: DownloadByteRange;
  /**
   * Bytes this response reported through `progress`. They leave the estimate of bytes in flight
   * when it ends, while other ranges of the session still stream; absent: none.
   */
  readonly streamed?: number;
}

interface Session {
  readonly key: string;
  readonly principal: string;
  readonly class: DownloadClass;
  readonly size: number;
  readonly queueAware: boolean;
  readonly seq: number;
  /** First arrival; the order of the queue. Kept when the session yields or pauses. */
  readonly arrival: number;
  queuedAt: number;
  state: 'waiting' | 'active';
  /** Responses streaming now; the place is freed only when none are. */
  inFlight: number;
  /** Ranges delivered in full: aborted responses add nothing. */
  coverage: DownloadCoverage;
  /**
   * Where the download starts: the lowest offset a response asked for, apart from reads of the
   * tail. A resumed download starts where it resumed, so it completes without the bytes before.
   */
  from: number | undefined;
  /** Bytes streamed by the responses in flight, for estimates only. */
  pending: number;
  startedAt: number;
  /** Waiting: no-show deadline. Active without responses: when its place is freed. */
  expiresAt: number;
  position: number | undefined;
  startsAt: number | undefined;
  checkAt: number;
  /** Among the first in line at the last tick: may take a free place when it comes. */
  claimable: boolean;
  /** The head this session yielded its place to: it takes no place while that one waits. */
  yieldedTo: string | undefined;
}

/** Places of sessions finishing within this time already count as free for the next in line. */
const HANDOVER_MS = 5000;
/** How soon a client that may take a place should come. */
const CLAIM_CHECK_MS = 1000;
/**
 * A session that only read the tail (a ZIP directory, an SDK resuming inside its last range)
 * keeps its place this long without responses: its next read, if any, follows at once, and a
 * place must not stand idle for `idleMs` after a download that may well be over.
 */
const TAIL_IDLE_MS = 5000;
/** A session keeps its place at least this long before it can be asked to yield. */
const MIN_HOLD_MS = 60_000;

/**
 * Download sessions of one process (ADR 0076): a place covers a whole download, not one range.
 * Time comes from the caller, so the rules are deterministic. No place is held for an absent
 * client: `plan`, the scheduler tick, marks the first in line, and whichever of them comes first
 * takes a free place. Every structure is bounded by the policy; nothing here keeps a timer.
 */
export class DownloadSessions {
  private readonly sessions = new Map<string, Session>();
  private readonly owned = new Map<string, number>();
  private readonly places = new DownloadOccupancy();
  private readonly rate = new DownloadRate();
  private readonly resumes: DownloadResumes;
  private seq = 0;
  private draining = false;
  /** Principals first in line at the last tick: their share then binds the others. */
  private readonly claimants = new Set<string>();
  /** The head of the queue waits with no place free: one active session may yield to it. */
  private pressure: Session | undefined;
  private readonly counters = {
    admitted: 0,
    queued: 0,
    completed: 0,
    noShows: 0,
    released: 0,
    yielded: 0,
    refused: 0,
  };
  constructor(private current: DownloadSchedulePolicy) {
    this.resumes = new DownloadResumes(() => this.current.maxSessions);
  }

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
    const decision = this.decide(request, now);
    const session = this.sessions.get(request.key);
    if (decision.state === 'active' && session) noteStart(session, request.range);
    return decision;
  }

  private decide(request: DownloadSessionRequest, now: number): DownloadDecision {
    const known = this.sessions.get(request.key);
    if (known?.state === 'active') return this.continueActive(known, now);
    if (this.draining) throw busy('Server is stopping; retry later', MIN_DOWNLOAD_CHECK_MS);
    if (!known) return this.open(request, now);
    if (known.claimable && this.places.fits(known, this.current, this.strictFor(known)))
      return this.admit(known, now);
    return this.queued(known, now);
  }

  /** Bytes streamed for an active session; feed the measured rate and its estimates. */
  progress(key: string, bytes: number, now: number) {
    const session = this.sessions.get(key);
    if (session?.state === 'active') session.pending += bytes;
    this.rate.add(bytes, now);
  }

  /**
   * A response ended. The download is complete when the delivered ranges reach from where it
   * started to the last byte and none is in flight: a tail read first (a ZIP directory) does not
   * set the start, so it never completes a download alone.
   */
  end(key: string, how: DownloadResponseEnd, now: number) {
    const session = this.sessions.get(key);
    if (session?.state !== 'active' || session.inFlight === 0) return;
    session.inFlight--;
    if (how.finished) session.coverage.add(how.range.start, how.range.end);
    // Exactly this response's bytes: a finished one now counts in the coverage instead, and
    // parallel ranges must not be counted twice.
    session.pending =
      session.inFlight === 0 ? 0 : Math.max(0, session.pending - (how.streamed ?? 0));
    session.expiresAt =
      now +
      (session.from === undefined
        ? Math.min(TAIL_IDLE_MS, this.current.idleMs)
        : this.current.idleMs);
    if (complete(session)) {
      this.counters.completed++;
      this.remove(session);
    }
  }

  /** The scheduler tick: frees idle places, drops no-shows, marks the next in line, estimates. */
  plan(now: number) {
    this.expire(now);
    this.resumes.prune(now);
    this.claimants.clear();
    this.pressure = undefined;
    if (this.draining) return;
    const order = orderWaitingDownloads(
      [...this.sessions.values()].filter((session) => session.state === 'waiting'),
      this.current,
      now,
    );
    const marked = this.markClaimants(order, now);
    const head = order[0];
    // No place is free: the head may get one that an active session yields at a range boundary;
    // it takes it once the next tick marks it free.
    if (marked === 0 && head && this.current.preempt) {
      this.claimants.add(head.principal);
      this.pressure = head;
    }
    this.estimate(order, now);
  }

  /**
   * Marks the first in line who may take a place: twice the free places, so whoever of them
   * comes first takes one and an absent client holds none. Places of sessions about to finish
   * count as free. People may use the reserve, the others only the places outside it.
   */
  private markClaimants(order: Session[], now: number) {
    const soon = finishingSoon([...this.sessions.values()], this.rate.capacity(now));
    const free = this.places.free(this.current);
    let all = 2 * (free.all + soon);
    let shared = 2 * (free.shared + soon);
    let marked = 0;
    for (const session of order) {
      const person = session.class === 'interactive';
      // A session that yielded must not take the place back before the head it yielded to: it
      // comes back sooner and would win the place, then hold it another MIN_HOLD_MS.
      if (
        session.yieldedTo !== undefined &&
        this.sessions.get(session.yieldedTo)?.state !== 'waiting'
      )
        session.yieldedTo = undefined;
      session.claimable = all > 0 && (person || shared > 0) && session.yieldedTo === undefined;
      if (!session.claimable) continue;
      all--;
      if (!person) shared--;
      marked++;
      this.claimants.add(session.principal);
    }
    return marked;
  }

  /** New sessions and waiting ones are refused; active ones finish. No place is handed on. */
  drain() {
    this.draining = true;
  }

  snapshot(now: number) {
    let oldest = now;
    for (const session of this.sessions.values())
      if (session.state === 'waiting') oldest = Math.min(oldest, session.queuedAt);
    return {
      active: this.places.active,
      waiting: { ...this.places.waitingOf },
      oldestWaitSeconds: Math.floor((now - oldest) / 1000),
      bytesPerSecond: Math.round(this.rate.capacity(now)),
      resumable: this.resumes.size,
      ...this.counters,
    };
  }

  get idle() {
    return this.sessions.size === 0;
  }

  /** When the session of `key` first came, for its queue ticket; undefined without one. */
  arrivalOf(key: string) {
    return this.sessions.get(key)?.arrival;
  }

  private continueActive(session: Session, now: number): DownloadDecision {
    if (session.inFlight >= this.current.rangesPerSession)
      throw busy('Too many ranges of one download at once', 1000);
    if (session.inFlight === 0 && this.shouldYield(session, now)) {
      this.yieldPlace(session, now);
      return this.queued(session, now);
    }
    session.inFlight++;
    return { state: 'active' };
  }

  private open(request: DownloadSessionRequest, now: number): DownloadDecision {
    const owned = this.owned.get(request.principal) ?? 0;
    if (
      this.sessions.size >= this.current.maxSessions ||
      owned >= this.current.maxSessionsPerPrincipal
    ) {
      this.counters.refused++;
      throw busy('Download queue is full', 60_000);
    }
    const resumed = this.resumes.take(request.key, now);
    const arrival = Math.min(now, resumed?.arrival ?? request.arrivedAt ?? now);
    const session: Session = {
      key: request.key,
      principal: request.principal,
      class: request.class,
      size: request.size,
      queueAware: request.queueAware,
      seq: resumed?.seq ?? ++this.seq,
      arrival,
      // A download back from a restart keeps its turn but starts aging afresh.
      queuedAt: resumed?.queuedAt ?? now,
      state: 'waiting',
      inFlight: 0,
      coverage: resumed?.coverage ?? new DownloadCoverage(),
      from: resumed?.from,
      pending: 0,
      startedAt: now,
      expiresAt: now,
      position: undefined,
      startsAt: undefined,
      checkAt: now + MIN_DOWNLOAD_CHECK_MS,
      claimable: false,
      yieldedTo: undefined,
    };
    this.sessions.set(session.key, session);
    this.owned.set(session.principal, owned + 1);
    this.places.wait(session);
    // A free place goes to it at once when nobody else waits, even beyond its principal's share;
    // to a person when no other person waits, the reserve is theirs. A download that only paused
    // keeps its arrival and so its turn, but waits in line like the others: it is not ahead of
    // those that came before it.
    const alone =
      this.places.waiting === 1 ||
      (session.class === 'interactive' && this.places.waitingOf.interactive === 1);
    if (alone && this.places.fits(session, this.current, false)) return this.admit(session, now);
    this.counters.queued++;
    return this.queued(session, now);
  }

  private admit(session: Session, now: number): DownloadDecision {
    this.places.leave(session);
    this.places.occupy(session);
    session.state = 'active';
    session.claimable = false;
    session.startedAt = now;
    session.expiresAt = now + this.current.idleMs;
    session.inFlight++;
    this.counters.admitted++;
    return { state: 'active' };
  }

  private queued(session: Session, now: number): DownloadDecision {
    const floor = session.claimable ? CLAIM_CHECK_MS : MIN_DOWNLOAD_CHECK_MS;
    const delay = Math.max(floor, session.checkAt - now);
    // A told client is expected back by then; until that deadline it keeps its turn.
    session.expiresAt = Math.max(session.expiresAt, now + downloadNoShowAfter(delay));
    return {
      state: 'queued',
      ...(session.position === undefined ? {} : { position: session.position }),
      ...(session.startsAt === undefined ? {} : { startsAt: Math.max(now, session.startsAt) }),
      checkAt: now + delay,
    };
  }

  /** The share of a principal binds while another principal is first in line. */
  private strictFor(session: Session) {
    for (const principal of this.claimants) if (principal !== session.principal) return true;
    return false;
  }

  /**
   * Whether this session, between two ranges, gives its place to the head of the queue: only a
   * client of the queue protocol, after holding the place a minute, when the head is of a higher
   * class or of a principal below its share while this one is above it.
   */
  private shouldYield(session: Session, now: number) {
    const pressure = this.pressure;
    if (
      !pressure ||
      // The head left the queue, or a place freed since the tick: it needs no yielded one.
      this.sessions.get(pressure.key) !== pressure ||
      pressure.state !== 'waiting' ||
      this.places.fits(pressure, this.current, false) ||
      !session.queueAware ||
      session.class === 'interactive' ||
      pressure.principal === session.principal ||
      now - session.startedAt < MIN_HOLD_MS
    )
      return false;
    const share = this.current.perPrincipalActive;
    return (
      classIndex(session.class) > classIndex(pressure.class) ||
      (this.places.of(session.principal) > share && this.places.of(pressure.principal) < share)
    );
  }

  private yieldPlace(session: Session, now: number) {
    this.places.vacate(session);
    this.places.wait(session);
    session.state = 'waiting';
    // A fresh wait: aging must not lift it straight back over the one it yielded to.
    session.queuedAt = now;
    session.claimable = false;
    session.yieldedTo = this.pressure?.key;
    session.position = undefined;
    session.checkAt = now + MIN_DOWNLOAD_CHECK_MS;
    this.pressure = undefined;
    this.counters.yielded++;
  }

  private expire(now: number) {
    for (const session of this.sessions.values()) {
      if (session.inFlight > 0 || now <= session.expiresAt) continue;
      if (session.state === 'waiting') this.counters.noShows++;
      else {
        this.counters.released++;
        // Not complete, or `end` would have removed it.
        this.resumes.keep(session.key, session, now);
      }
      this.remove(session);
    }
  }

  private estimate(order: Session[], now: number) {
    const left: number[] = [];
    for (const session of this.sessions.values())
      if (session.state === 'active') left.push(remaining(session));
    const starts = estimateDownloadStarts(
      left,
      order.map(remaining),
      this.current.slots - this.current.interactiveReserve,
      this.rate.capacity(now),
    );
    order.forEach((session, index) => {
      const startsIn = starts[index];
      session.position = index + 1;
      session.startsAt = startsIn === undefined ? undefined : now + startsIn;
      // Those who may take a place check sooner, down to a second: a place may free early.
      const delay = downloadCheckDelay(startsIn, session.position, session.seq);
      session.checkAt =
        now +
        (session.claimable
          ? Math.max(CLAIM_CHECK_MS, Math.min(delay, (startsIn ?? 0) / 2))
          : delay);
    });
  }

  private remove(session: Session) {
    this.sessions.delete(session.key);
    if (session.state === 'waiting') this.places.leave(session);
    else this.places.vacate(session);
    const owned = (this.owned.get(session.principal) ?? 1) - 1;
    if (owned === 0) this.owned.delete(session.principal);
    else this.owned.set(session.principal, owned);
  }
}

/**
 * Where an admitted response says the download starts: its offset, unless it reads the tail
 * without saying so (a suffix or bounded range ending at the last byte, see the range).
 */
function noteStart(session: Session, asked: DownloadByteRange | undefined) {
  const range = asked ?? { start: 0, end: session.size - 1, open: true };
  if (range.open || range.start === 0 || range.end < session.size - 1)
    session.from = Math.min(session.from ?? range.start, range.start);
}

/** Sessions streaming now that will have sent their last byte within HANDOVER_MS. */
function finishingSoon(sessions: readonly Session[], bytesPerSecond: number) {
  const streaming = sessions.filter((session) => session.inFlight > 0);
  const perSession = bytesPerSecond / Math.max(1, streaming.length);
  if (perSession === 0) return 0;
  return streaming.filter((session) => remaining(session) / perSession <= HANDOVER_MS / 1000)
    .length;
}

/** Delivered from where it started to the last byte, with no response in flight. */
function complete(session: Session) {
  const from = session.from;
  return (
    session.inFlight === 0 && from !== undefined && session.coverage.covers(from, session.size - 1)
  );
}

/** Bytes still to deliver, estimated: streamed bytes count before their response ends. */
function remaining(session: Session) {
  const from = session.from ?? 0;
  return Math.max(0, session.size - from - session.coverage.bytesFrom(from) - session.pending);
}

function classIndex(name: DownloadClass) {
  return downloadClasses.indexOf(name);
}

function busy(message: string, retryMs: number) {
  return new ArkvoryError('busy', message, { retryAfterSeconds: Math.ceil(retryMs / 1000) });
}
