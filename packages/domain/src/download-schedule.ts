import { ArkvoryError } from './artifact.js';

/** Priority classes, highest first (ADR 0076). */
export const downloadClasses = ['interactive', 'release', 'bulk', 'background'] as const;
export type DownloadClass = (typeof downloadClasses)[number];
export const downloadStrategies = ['ordered', 'smallest-first', 'shared'] as const;
export type DownloadStrategy = (typeof downloadStrategies)[number];

export interface DownloadSchedulePolicy {
  readonly strategy: DownloadStrategy;
  /** Sessions that move bytes at once. */
  readonly slots: number;
  readonly weights: Readonly<Record<DownloadClass, number>>;
  /** Slots only `interactive` may take, so people are served during a mass update. */
  readonly interactiveReserve: number;
  /** Active sessions of one principal while sessions of other principals wait. */
  readonly perPrincipalActive: number;
  readonly maxSessions: number;
  readonly maxSessionsPerPrincipal: number;
  /** A pause between ranges longer than this frees the place of an active session. */
  readonly idleMs: number;
  /** Each such wait lifts a waiting session one class higher, so nobody starves. */
  readonly agingMs: number;
}

const second = 1000;
const minute = 60 * second;
export const DEFAULT_DOWNLOAD_WEIGHTS: Readonly<Record<DownloadClass, number>> = {
  interactive: 8,
  release: 4,
  bulk: 2,
  background: 1,
};

/** The safe defaults of ADR 0076 for `slots` sessions; every field can be overridden. */
export function downloadSchedulePolicy(
  slots: number,
  overrides: Partial<DownloadSchedulePolicy> = {},
): DownloadSchedulePolicy {
  const policy: DownloadSchedulePolicy = {
    strategy: 'ordered',
    slots,
    weights: DEFAULT_DOWNLOAD_WEIGHTS,
    interactiveReserve: slots > 1 ? 1 : 0,
    perPrincipalActive: Math.min(4, slots),
    maxSessions: 65536,
    maxSessionsPerPrincipal: 4096,
    idleMs: 30 * second,
    agingMs: 15 * minute,
    ...overrides,
  };
  const counts = [policy.slots, policy.perPrincipalActive, policy.maxSessions];
  const valid =
    downloadStrategies.includes(policy.strategy) &&
    counts.every((value) => Number.isSafeInteger(value) && value >= 1) &&
    Number.isSafeInteger(policy.interactiveReserve) &&
    policy.interactiveReserve >= 0 &&
    policy.interactiveReserve < policy.slots &&
    policy.perPrincipalActive <= policy.slots &&
    Number.isSafeInteger(policy.maxSessionsPerPrincipal) &&
    policy.maxSessionsPerPrincipal >= 1 &&
    policy.maxSessionsPerPrincipal <= policy.maxSessions &&
    policy.maxSessions <= 1_048_576 &&
    [policy.idleMs, policy.agingMs].every((ms) => Number.isSafeInteger(ms) && ms >= second) &&
    downloadClasses.every((name) => {
      const weight = policy.weights[name];
      return Number.isSafeInteger(weight) && weight >= 1 && weight <= 1000;
    });
  if (!valid) throw new ArkvoryError('invalid_input', 'Invalid download schedule');
  return policy;
}

/** A caller may ask for a lower class than its own, never a higher one. */
export function requestedDownloadClass(own: DownloadClass, asked: unknown): DownloadClass {
  if (typeof asked !== 'string') return own;
  const index = downloadClasses.findIndex((name) => name === asked);
  return index > downloadClasses.indexOf(own) ? (downloadClasses[index] ?? own) : own;
}

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
  const steps = Math.floor(Math.max(0, now - item.queuedAt) / policy.agingMs);
  return Math.max(0, downloadClasses.indexOf(item.class) - steps);
}

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

/** Principals in turn by their earliest arrival; each principal's sessions in arrival order. */
function inTurns<T extends WaitingDownload>(group: T[]): T[] {
  const byPrincipal = new Map<string, T[]>();
  for (const item of [...group].sort((a, b) => a.seq - b.seq)) {
    const queue = byPrincipal.get(item.principal);
    if (queue) queue.push(item);
    else byPrincipal.set(item.principal, [item]);
  }
  const queues = [...byPrincipal.values()];
  const result: T[] = [];
  for (let round = 0; result.length < group.length; round++)
    for (const queue of queues) {
      const item = queue[round];
      if (item) result.push(item);
    }
  return result;
}

/**
 * When each waiting session should start, in milliseconds from now: places free up as the
 * active sessions' remaining bytes drain, each place moving `bytesPerSecond / places`. A min-heap
 * of the places' free times keeps this O(n log places). Undefined without a measured rate.
 */
export function estimateDownloadStarts(
  activeRemaining: readonly number[],
  waitingSizes: readonly number[],
  places: number,
  bytesPerSecond: number,
): (number | undefined)[] {
  if (!(bytesPerSecond > 0) || places < 1) return waitingSizes.map(() => undefined);
  const perPlace = bytesPerSecond / places / second;
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
