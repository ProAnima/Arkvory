import {
  downloadClasses,
  type DownloadClass,
  type DownloadSchedulePolicy,
} from './download-policy.js';
import {
  downloadCheckDelay,
  estimateDownloadStarts,
  MIN_DOWNLOAD_CHECK_MS,
} from './download-schedule.js';
import { DownloadCoverage, type DownloadByteRange } from './download-coverage.js';
import type { DownloadOccupancy } from './download-occupancy.js';
import type { DownloadResume } from './download-resumes.js';

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

export interface Session {
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
export const CLAIM_CHECK_MS = 1000;
/** A session keeps its place at least this long before it can be asked to yield. */
const MIN_HOLD_MS = 60_000;

/** A new waiting session; one back from a pause keeps its turn and its delivered ranges. */
export function openSession(
  request: DownloadSessionRequest,
  seq: number,
  resumed: DownloadResume | undefined,
  now: number,
): Session {
  return {
    key: request.key,
    principal: request.principal,
    class: request.class,
    size: request.size,
    queueAware: request.queueAware,
    seq,
    arrival: Math.min(now, resumed?.arrival ?? request.arrivedAt ?? now),
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
}

/**
 * Whether this session, between two ranges, gives its place to the waiting head of the queue:
 * only a client of the queue protocol, after holding the place a minute, when the head is of a
 * higher class or of a principal below its share while this one is above it.
 */
export function yieldsTo(
  session: Session,
  head: Session,
  places: DownloadOccupancy,
  policy: DownloadSchedulePolicy,
  now: number,
) {
  if (
    head.state !== 'waiting' ||
    // A place freed since the tick: the head needs no yielded one.
    places.fits(head, policy, false) ||
    !session.queueAware ||
    session.class === 'interactive' ||
    head.principal === session.principal ||
    now - session.startedAt < MIN_HOLD_MS
  )
    return false;
  const share = policy.perPrincipalActive;
  return (
    classIndex(session.class) > classIndex(head.class) ||
    (places.of(session.principal) > share && places.of(head.principal) < share)
  );
}

/** Tells every waiting session in `order` its place and estimated start. */
export function estimateQueue(
  sessions: Iterable<Session>,
  order: readonly Session[],
  policy: DownloadSchedulePolicy,
  bytesPerSecond: number,
  now: number,
) {
  const left: number[] = [];
  for (const session of sessions) if (session.state === 'active') left.push(remaining(session));
  const starts = estimateDownloadStarts(
    left,
    order.map(remaining),
    policy.slots - policy.interactiveReserve,
    bytesPerSecond,
  );
  order.forEach((session, index) => {
    tellPlace(session, index + 1, starts[index], now);
  });
}

/**
 * Where an admitted response says the download starts: its offset, unless it reads the tail
 * without saying so (a suffix or bounded range ending at the last byte, see the range).
 */
export function noteStart(session: Session, asked: DownloadByteRange | undefined) {
  const range = asked ?? { start: 0, end: session.size - 1, open: true };
  if (range.open || range.start === 0 || range.end < session.size - 1)
    session.from = Math.min(session.from ?? range.start, range.start);
}

/** A waiting session's place, estimated start and when it should check again. */
function tellPlace(session: Session, position: number, startsIn: number | undefined, now: number) {
  session.position = position;
  session.startsAt = startsIn === undefined ? undefined : now + startsIn;
  // Those who may take a place check sooner, down to a second: a place may free early.
  const delay = downloadCheckDelay(startsIn, position, session.seq);
  session.checkAt =
    now +
    (session.claimable ? Math.max(CLAIM_CHECK_MS, Math.min(delay, (startsIn ?? 0) / 2)) : delay);
}

/** Sessions streaming now that will have sent their last byte within HANDOVER_MS. */
export function finishingSoon(sessions: readonly Session[], bytesPerSecond: number) {
  const streaming = sessions.filter((session) => session.inFlight > 0);
  const perSession = bytesPerSecond / Math.max(1, streaming.length);
  if (perSession === 0) return 0;
  return streaming.filter((session) => remaining(session) / perSession <= HANDOVER_MS / 1000)
    .length;
}

/** Delivered from where it started to the last byte, with no response in flight. */
export function complete(session: Session) {
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
