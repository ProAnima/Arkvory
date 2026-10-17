import {
  ArkvoryError,
  EVENT_SCAN_ROWS,
  authorizeAction,
  eventTypeNames,
  requireRepository,
} from '@proanima/arkvory-domain';
import type { EventScope, Principal } from '@proanima/arkvory-domain';
import { effectivePermissions } from './effective-permissions.js';

/** One sequenced event as the outbox holds it (ADR 0080). */
export interface EventRecord {
  readonly position: bigint;
  readonly type: string;
  readonly schemaVersion: number;
  readonly scope: EventScope;
  readonly repository: string | null;
  readonly partitionKey: string;
  readonly subject: string;
  /** ISO 8601 UTC, from the database clock of the change. */
  readonly occurredAt: string;
  readonly data: Readonly<Record<string, unknown>>;
}
/** What one read may return: events visible to the caller among a bounded scan. */
export interface EventLogQuery {
  /** Null: from the oldest retained position of the same snapshot. */
  readonly after: bigint | null;
  readonly limit: number;
  /** Rows looked at, visible or not. */
  readonly scan: number;
  readonly repositories: readonly string[];
  readonly system: boolean;
  /** Exact type names; null for every type. */
  readonly types: readonly string[] | null;
}
export interface EventWindow {
  readonly epoch: string;
  /** The lowest cursor still accepted: every event after it is retained. */
  readonly oldest: bigint;
  readonly head: bigint;
}
/** One consistent snapshot: the window and the events after `after` in it. */
export interface EventLogPage extends EventWindow {
  readonly after: bigint;
  readonly items: readonly EventRecord[];
  /** Highest position the bounded scan looked at; null when nothing follows `after`. */
  readonly scannedThrough: bigint | null;
}
/** Reading port of the outbox; the adapter reads the window and the rows in one snapshot. */
export interface EventLogReader {
  read(query: EventLogQuery): Promise<EventLogPage>;
}

export interface EventCursor {
  readonly epoch: string;
  readonly position: bigint;
}
export interface EventQuery {
  readonly cursor: EventCursor | null;
  readonly limit: number;
  readonly types: readonly string[] | null;
  readonly repository: string | null;
}
export type EventListOutcome =
  | {
      readonly kind: 'page';
      readonly window: EventWindow;
      readonly items: readonly EventRecord[];
      /** Cursor of the next read; past invisible events too, so narrow callers move on. */
      readonly next: bigint;
    }
  | { readonly kind: 'cursor_expired'; readonly window: EventWindow }
  | { readonly kind: 'epoch_changed'; readonly window: EventWindow };

export const MAX_EVENT_PAGE = 500;
export const DEFAULT_EVENT_PAGE = 100;
const MAX_TYPE_FILTERS = 32;
const MAX_POSITION = 2n ** 63n - 1n;
const cursorPattern =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(0|[1-9][0-9]{0,18})$/;

const invalid = (field: string, problem: 'format' | 'range' | 'invalid', message: string) =>
  new ArkvoryError('invalid_input', message, {
    reason: 'validation',
    details: [{ field, problem }],
  });

/** `<epoch>:<position>`, the `id` of an event or the `next` of a page. */
export function parseEventCursor(value: string): EventCursor {
  const match = cursorPattern.exec(value);
  const epoch = match?.[1];
  const position = match?.[2];
  if (epoch === undefined || position === undefined || BigInt(position) > MAX_POSITION)
    throw invalid('after', 'format', 'after must be an event id: <epoch>:<position>');
  return { epoch, position: BigInt(position) };
}

/** Exact names and `prefix.*` of known types, expanded to the exact names they select. */
export function parseEventTypes(value: string): readonly string[] {
  const entries = value.split(',');
  if (entries.length > MAX_TYPE_FILTERS || entries.some((entry) => entry === ''))
    throw invalid('types', 'range', 'types must list 1 to 32 names');
  const selected = new Set<string>();
  for (const entry of entries) {
    const matches = entry.endsWith('.*')
      ? eventTypeNames.filter((name) => name.startsWith(entry.slice(0, -1)))
      : eventTypeNames.filter((name) => name === entry);
    if (matches.length === 0) throw invalid('types', 'invalid', 'Unknown event type');
    for (const name of matches) selected.add(name);
  }
  return [...selected].sort();
}

const text = (value: unknown, field: string): string => {
  if (typeof value !== 'string') throw invalid(field, 'format', `${field} must be a string`);
  return value;
};

/** Query parameters of `GET /api/v1/events` from the request's unknown query object. */
export function parseEventQuery(query: Readonly<Record<string, unknown>>): EventQuery {
  for (const key of Object.keys(query))
    if (!['after', 'limit', 'types', 'repository'].includes(key))
      throw new ArkvoryError('invalid_input', 'Unknown event feed option', {
        reason: 'validation',
        details: [{ field: key, problem: 'invalid' }],
      });
  const { after, limit, types, repository } = query;
  const size = limit === undefined ? String(DEFAULT_EVENT_PAGE) : text(limit, 'limit');
  if (!/^[1-9][0-9]{0,2}$/.test(size) || Number(size) > MAX_EVENT_PAGE)
    throw invalid('limit', 'range', 'limit must be 1 to 500');
  return {
    cursor: after === undefined ? null : parseEventCursor(text(after, 'after')),
    limit: Number(size),
    types: types === undefined ? null : parseEventTypes(text(types, 'types')),
    repository: repository === undefined ? null : requireRepository(text(repository, 'repository')),
  };
}

const allowed = (check: () => void): boolean => {
  try {
    check();
    return true;
  } catch (error) {
    if (error instanceof ArkvoryError && error.code === 'forbidden') return false;
    throw error;
  }
};

/**
 * What the caller may read (ADR 0080): repository events with `artifact.list` on that
 * repository, as for the repository change feed; system events for a global administrator
 * signed in directly, never through a personal token or a managed key. Computed from the
 * principal of every request, so a revoked grant hides events at once.
 */
export function eventVisibility(principal: Principal): {
  readonly repositories: readonly string[];
  readonly system: boolean;
} {
  const candidates = new Set(effectivePermissions(principal).map((b) => b.resource.id));
  const repositories = [...candidates]
    .filter((repository) =>
      allowed(() => {
        authorizeAction(principal, repository, 'artifact.list', ['read']);
      }),
    )
    .sort();
  const system =
    principal.administrator === true &&
    !principal.managed &&
    principal.credential !== 'personal-token';
  return { repositories, system };
}

/** Reads the installation's event feed for one caller: ACL, bounded scan, cursor checks. */
export class EventFeed {
  constructor(private readonly log: EventLogReader) {}

  async list(principal: Principal, query: EventQuery): Promise<EventListOutcome> {
    const visibility = eventVisibility(principal);
    if (query.repository !== null)
      // An explicit repository the caller cannot list is refused, as on its change feed.
      authorizeAction(principal, query.repository, 'artifact.list', ['read']);
    const page = await this.log.read({
      after: query.cursor?.position ?? null,
      limit: query.limit,
      scan: EVENT_SCAN_ROWS,
      repositories: query.repository === null ? visibility.repositories : [query.repository],
      system: query.repository === null && visibility.system,
      types: query.types,
    });
    const window: EventWindow = { epoch: page.epoch, oldest: page.oldest, head: page.head };
    if (query.cursor !== null && query.cursor.epoch !== page.epoch)
      return { kind: 'epoch_changed', window };
    if (page.after < page.oldest) return { kind: 'cursor_expired', window };
    if (page.after > page.head)
      throw invalid('after', 'range', 'after is beyond the newest event of this epoch');
    const last = page.items.at(-1);
    const next =
      page.items.length === query.limit && last
        ? last.position
        : (page.scannedThrough ?? page.after);
    return { kind: 'page', window, items: page.items, next };
  }
}
