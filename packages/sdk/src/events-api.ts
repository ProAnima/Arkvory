import { readEventPage, readEventTypes } from '@proanima/arkvory-contracts';
import type {
  CloudEventResponse,
  EventPageResponse,
  EventTypeListResponse,
} from '@proanima/arkvory-contracts';
import type { HttpPort } from './http-transport.js';
import { ArkvoryClientError, ArkvoryHttpError, ArkvoryNetworkError, delay } from './transfer.js';

export interface EventListOptions {
  /** `<epoch>:<position>`: an event id or the `next` of a page; absent: from the oldest event. */
  readonly after?: string;
  /** 1–500, 100 by default. */
  readonly limit?: number;
  /** Exact names or prefixes such as `artifact.*`. */
  readonly types?: readonly string[];
  readonly repository?: string;
}
export interface EventFollowOptions extends EventListOptions {
  readonly signal?: AbortSignal;
  /**
   * Stores the cursor after each event the consumer has handled and at the end of every page
   * (the cursor also moves past events the caller may not see). Resume with `after`.
   */
  readonly save?: (cursor: string) => void | Promise<void>;
  /** Pause after a page that reached the newest event, 2000 ms by default. */
  readonly pollMs?: number;
  /** Transient failures in a row before follow gives up, 5 by default. */
  readonly retries?: number;
}

const transientStatuses = new Set([408, 429, 502, 503, 504]);
const transient = (error: unknown) =>
  error instanceof ArkvoryNetworkError ||
  (error instanceof ArkvoryHttpError && transientStatuses.has(error.status));

function query(options: EventListOptions): string {
  const search = new URLSearchParams();
  if (options.after !== undefined) search.set('after', options.after);
  if (options.limit !== undefined) {
    if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 500)
      throw new ArkvoryClientError('invalid_argument', 'limit must be 1 to 500');
    search.set('limit', String(options.limit));
  }
  if (options.types !== undefined) search.set('types', options.types.join(','));
  if (options.repository !== undefined) search.set('repository', options.repository);
  const text = search.toString();
  return text ? `?${text}` : '';
}

/**
 * The installation's event feed (ADR 0080). Events are hints: deduplicate by `id` and read the
 * current state through the ordinary routes. A cursor older than the server keeps (410,
 * `events_cursor_expired`) or of a restored installation (409, `events_epoch_changed`) is an
 * ArkvoryHttpError whose `events` holds the current window; resynchronize, then continue.
 */
export class EventsApi {
  constructor(private readonly http: HttpPort) {}

  async list(options: EventListOptions = {}, signal?: AbortSignal): Promise<EventPageResponse> {
    return readEventPage(
      await this.http.call(`api/v1/events${query(options)}`, 'GET', undefined, signal),
    );
  }

  async types(signal?: AbortSignal): Promise<EventTypeListResponse> {
    return readEventTypes(await this.http.call('api/v1/events/types', 'GET', undefined, signal));
  }

  /**
   * Every event after `after`, oldest first, until `signal` aborts. Transient failures are
   * repeated with a bounded backoff; any other failure, an expired cursor included, ends the
   * iteration with its error. The cursor is saved only after the consumer resumed the loop.
   */
  async *follow(options: EventFollowOptions = {}): AsyncGenerator<CloudEventResponse> {
    const { signal, save } = options;
    const pollMs = options.pollMs ?? 2000;
    const limit = options.limit ?? 100;
    let after = options.after;
    let failures = 0;
    for (;;) {
      signal?.throwIfAborted();
      let page: EventPageResponse;
      try {
        page = await this.list({ ...options, limit, ...(after ? { after } : {}) }, signal);
        failures = 0;
      } catch (error) {
        signal?.throwIfAborted();
        if (!transient(error) || ++failures > (options.retries ?? 5)) throw error;
        const hinted = error instanceof ArkvoryHttpError ? error.retryAfterMs : undefined;
        await delay(hinted ?? Math.min(pollMs * 2 ** failures, 30_000), signal);
        continue;
      }
      let saved = after;
      for (const event of page.items) {
        yield event;
        await save?.(event.id);
        saved = event.id;
      }
      if (page.next !== saved) await save?.(page.next);
      after = page.next;
      if (page.items.length < limit) await delay(pollMs, signal);
    }
  }
}
