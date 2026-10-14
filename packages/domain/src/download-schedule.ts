import {
  downloadClasses,
  type DownloadClass,
  type DownloadSchedulePolicy,
} from './download-policy.js';

const second = 1000;
const minute = 60 * second;

export interface WaitingDownload {
  readonly principal: string;
  readonly class: DownloadClass;
  readonly size: number;
  /** Arrival order: lower came first. */
  readonly seq: number;
  readonly queuedAt: number;
}

/** The class a waiting session competes in after aging. */
export function agedClassIndex(item: WaitingDownload, policy: DownloadSchedulePolicy, now: number) {
  const own = downloadClasses.indexOf(item.class);
  if (policy.agingMs === 0 || own <= RELEASE) return own;
  const steps = Math.floor(Math.max(0, now - item.queuedAt) / policy.agingMs);
  // Aging stops at `release`: the lane of people stays theirs.
  return Math.max(RELEASE, own - steps);
}
const RELEASE = downloadClasses.indexOf('release');

/**
 * The order in which waiting sessions get places. Classes alternate by weight (stride
 * scheduling, so `bulk` still moves while `release` waits); inside a class `ordered` serves the
 * principals in turn, each first come first served, and `smallest-first` takes the smallest
 * object first. Aging is applied before grouping.
 */
export function orderWaitingDownloads<T extends WaitingDownload>(
  waiting: readonly T[],
  policy: DownloadSchedulePolicy,
  now: number,
): T[] {
  const groups = downloadClasses.map(() => [] as T[]);
  for (const item of waiting) groups[agedClassIndex(item, policy, now)]?.push(item);
  const lanes = groups.map((group) =>
    policy.strategy === 'smallest-first'
      ? group.sort((a, b) => a.size - b.size || a.seq - b.seq)
      : inTurns(group),
  );
  const passes = downloadClasses.map(() => 0);
  const cursors = downloadClasses.map(() => 0);
  const order: T[] = [];
  while (order.length < waiting.length) {
    let pick = -1;
    for (let index = 0; index < lanes.length; index++) {
      const lane = lanes[index] ?? [];
      if ((cursors[index] ?? 0) >= lane.length) continue;
      if (pick < 0 || (passes[index] ?? 0) < (passes[pick] ?? 0)) pick = index;
    }
    const lane = lanes[pick] ?? [];
    const item = lane[cursors[pick] ?? 0];
    if (!item) break;
    order.push(item);
    cursors[pick] = (cursors[pick] ?? 0) + 1;
    const name = downloadClasses[pick] ?? 'background';
    passes[pick] = (passes[pick] ?? 0) + 1 / policy.weights[name];
  }
  return order;
}

/**
 * Principals in turn by their earliest arrival; each principal's sessions in arrival order. A
 * session's round is its place among its principal's sessions, so one sort orders them all:
 * O(n log n) however the sessions are spread over principals.
 */
function inTurns<T extends WaitingDownload>(group: T[]): T[] {
  const sorted = [...group].sort((a, b) => a.seq - b.seq);
  const first = new Map<string, number>();
  const counts = new Map<string, number>();
  const rounds = new Map<T, number>();
  for (const item of sorted) {
    if (!first.has(item.principal)) first.set(item.principal, item.seq);
    const round = counts.get(item.principal) ?? 0;
    counts.set(item.principal, round + 1);
    rounds.set(item, round);
  }
  const key = (item: T) => [rounds.get(item) ?? 0, first.get(item.principal) ?? 0] as const;
  return sorted.sort((a, b) => {
    const [roundA, firstA] = key(a);
    const [roundB, firstB] = key(b);
    return roundA - roundB || firstA - firstB;
  });
}

/**
 * When each waiting session should start, in milliseconds from now: places free up as the
 * active sessions' remaining bytes drain, the link shared by the downloads that run. A min-heap
 * of the places' free times keeps this O(n log places). Undefined without a measured rate.
 */
export function estimateDownloadStarts(
  activeRemaining: readonly number[],
  waitingSizes: readonly number[],
  places: number,
  bytesPerSecond: number,
): (number | undefined)[] {
  if (!(bytesPerSecond > 0) || places < 1) return waitingSizes.map(() => undefined);
  // The link is shared by the downloads that run, not by the places: near the end of a queue
  // fewer run, each faster.
  const running = Math.min(places, activeRemaining.length + waitingSizes.length);
  const perPlace = bytesPerSecond / Math.max(1, running) / second;
  const heap: number[] = [];
  const busy = [...activeRemaining].sort((a, b) => a - b);
  for (let index = 0; index < places; index++) push(heap, (busy[index] ?? 0) / perPlace);
  // More active sessions than places (a reserve, a policy change): the rest queue as well.
  for (const remaining of busy.slice(places)) push(heap, pop(heap) + remaining / perPlace);
  return waitingSizes.map((size) => {
    const start = pop(heap);
    push(heap, start + size / perPlace);
    return Math.ceil(start);
  });
}

function push(heap: number[], value: number) {
  heap.push(value);
  for (let index = heap.length - 1; index > 0;) {
    const parent = Math.floor((index - 1) / 2);
    const above = heap[parent] ?? 0;
    if (above <= value) break;
    heap[index] = above;
    heap[parent] = value;
    index = parent;
  }
}

function pop(heap: number[]): number {
  const top = heap[0] ?? 0;
  const last = heap.pop() ?? 0;
  if (heap.length === 0) return top;
  heap[0] = last;
  for (let index = 0; ;) {
    const left = index * 2 + 1;
    const right = left + 1;
    let least = index;
    if (left < heap.length && (heap[left] ?? 0) < (heap[least] ?? 0)) least = left;
    if (right < heap.length && (heap[right] ?? 0) < (heap[least] ?? 0)) least = right;
    if (least === index) return top;
    heap[index] = heap[least] ?? 0;
    heap[least] = last;
    index = least;
  }
}

/** How soon a waiting client should come back: halfway to its start, 2 s to 5 min. */
export const MIN_DOWNLOAD_CHECK_MS = 2 * second;
export const MAX_DOWNLOAD_CHECK_MS = 5 * minute;

/**
 * The pause before a waiting client checks again. Halfway to the estimated start, so checks get
 * denser as the start nears; without an estimate a second per place ahead. Up to a quarter more,
 * fixed per session by `seq`, keeps clients told at the same moment from coming back together.
 */
export function downloadCheckDelay(
  startsInMs: number | undefined,
  position: number,
  seq: number,
): number {
  const until = startsInMs ?? position * second;
  const base = Math.min(MAX_DOWNLOAD_CHECK_MS, Math.max(MIN_DOWNLOAD_CHECK_MS, until / 2));
  const spread = 1 + ((seq * 7919) % 1000) / 4000;
  return Math.ceil(base * spread);
}

/**
 * How long a waiting session survives without its client: the clients of ADR 0076 add up to half
 * of Retry-After as jitter, and a request needs time to arrive.
 */
export function downloadNoShowAfter(checkDelayMs: number): number {
  return Math.ceil(checkDelayMs * 1.5) + 15 * second;
}
