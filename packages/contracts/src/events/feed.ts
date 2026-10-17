import { integer, items, record, text } from '../wire-values.js';
import { nativeErrorResponse } from '../errors.js';
import { cloudEventType, eventCatalog, eventDataSchemaUri } from './catalog.js';
import type { EventScopeName, EventTypeDescription } from './catalog.js';

/*
 * The installation's event feed (ADR 0080): CloudEvents 1.0 in structured JSON mode, read with
 * a cursor. Positions are 64-bit decimal strings; a cursor is `<epoch>:<position>`, the `id` of
 * an event or the `next` of a page, so a restored installation (new epoch) is recognized.
 */
export interface CloudEventResponse {
  readonly specversion: '1.0';
  /** `<epoch>:<position>`; consumers deduplicate by it. */
  readonly id: string;
  readonly source: string;
  /** `arkvory.<name>.v<schemaVersion>`. */
  readonly type: string;
  readonly subject: string;
  readonly time: string;
  readonly datacontenttype: 'application/json';
  readonly dataschema: string;
  readonly partitionkey: string;
  readonly arkvoryposition: string;
  readonly arkvoryepoch: string;
  readonly data: Readonly<Record<string, unknown>>;
}
export interface EventPageResponse {
  readonly epoch: string;
  readonly items: readonly CloudEventResponse[];
  /** Cursor to pass as `after` next time; it also moves past events the caller may not see. */
  readonly next: string;
  readonly head: string;
  /** The lowest position a cursor may still name; older cursors answer 410. */
  readonly oldest: string;
}
export interface EventTypeListResponse {
  readonly items: readonly EventTypeDescription[];
}

/** What the server knows of a stored event; the envelope adds the CloudEvents attributes. */
export interface StoredEvent {
  readonly position: string;
  readonly type: string;
  readonly schemaVersion: number;
  readonly scope: EventScopeName;
  readonly repository: string | null;
  readonly partitionKey: string;
  readonly subject: string;
  readonly occurredAt: string;
  readonly data: Readonly<Record<string, unknown>>;
}

/** The CloudEvent of a stored event; `site` is the installation's site name (any script). */
export function cloudEvent(event: StoredEvent, epoch: string, site: string): CloudEventResponse {
  const origin = `/arkvory/${encodeURIComponent(site)}`;
  return {
    specversion: '1.0',
    id: `${epoch}:${event.position}`,
    source:
      event.repository === null
        ? `${origin}/system`
        : `${origin}/repositories/${encodeURIComponent(event.repository)}`,
    type: cloudEventType(event.type, event.schemaVersion),
    subject: event.subject,
    time: event.occurredAt,
    datacontenttype: 'application/json',
    dataschema: eventDataSchemaUri(event.type, event.schemaVersion),
    partitionkey: event.partitionKey,
    arkvoryposition: event.position,
    arkvoryepoch: epoch,
    data: event.data,
  };
}

const uuidPattern = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
const decimalPattern = '^(0|[1-9][0-9]{0,18})$';
export const eventCursorPattern = `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:(0|[1-9][0-9]{0,18})$`;

function matching(value: unknown, pattern: string): string {
  const parsed = text(value);
  if (!new RegExp(pattern).test(parsed)) throw new Error('Invalid server event value');
  return parsed;
}

/** Strict for the envelope; `data` stays an open object, newer servers may add fields. */
export function readCloudEvent(value: unknown): CloudEventResponse {
  const row = record(value);
  if (row['specversion'] !== '1.0' || row['datacontenttype'] !== 'application/json')
    throw new Error('Invalid server event envelope');
  const epoch = matching(row['arkvoryepoch'], uuidPattern);
  const position = matching(row['arkvoryposition'], decimalPattern);
  const id = matching(row['id'], eventCursorPattern);
  if (id !== `${epoch}:${position}`) throw new Error('Invalid server event id');
  return {
    specversion: '1.0',
    id,
    source: matching(row['source'], '^/arkvory/'),
    type: matching(row['type'], '^arkvory\\.[a-z0-9.]+\\.v[1-9][0-9]*$'),
    subject: text(row['subject']),
    time: text(row['time']),
    datacontenttype: 'application/json',
    dataschema: matching(row['dataschema'], '^urn:arkvory:event:'),
    partitionkey: text(row['partitionkey']),
    arkvoryposition: position,
    arkvoryepoch: epoch,
    data: record(row['data']),
  };
}

export function readEventPage(value: unknown): EventPageResponse {
  const page = record(value);
  return {
    epoch: matching(page['epoch'], uuidPattern),
    items: items(page['items']).map(readCloudEvent),
    next: matching(page['next'], eventCursorPattern),
    head: matching(page['head'], decimalPattern),
    oldest: matching(page['oldest'], decimalPattern),
  };
}

/**
 * True when the page reached the newest event of its snapshot. A page shorter than `limit` is
 * not the end: one read scans a bounded number of rows, and `next` may stop below `head` after
 * events the caller may not see or did not select.
 */
export function eventPageReachedHead(page: EventPageResponse): boolean {
  const position = page.next.slice(page.next.lastIndexOf(':') + 1);
  return BigInt(position) >= BigInt(page.head);
}

export function readEventTypes(value: unknown): EventTypeListResponse {
  return {
    items: items(record(value)['items']).map((entry) => {
      const row = record(entry);
      const scope = row['scope'];
      const permission = row['permission'];
      if (scope !== 'repository' && scope !== 'system') throw new Error('Invalid event scope');
      if (permission !== 'artifact.list' && permission !== 'administrator')
        throw new Error('Invalid event permission');
      return {
        name: text(row['name']),
        schemaVersion: integer(row['schemaVersion']),
        scope,
        permission,
        partition: text(row['partition']),
        description: text(row['description']),
        dataSchema: record(row['dataSchema']),
      };
    }),
  };
}

/** Wire form of the catalog for `GET /api/v1/events/types`. */
export const eventTypeList = (): EventTypeListResponse => ({ items: eventCatalog });

const eventSchema = {
  type: 'object',
  required: [
    'specversion',
    'id',
    'source',
    'type',
    'subject',
    'time',
    'datacontenttype',
    'dataschema',
    'partitionkey',
    'arkvoryposition',
    'arkvoryepoch',
    'data',
  ],
  properties: {
    specversion: { type: 'string', enum: ['1.0'] },
    id: {
      type: 'string',
      pattern: eventCursorPattern,
      description: 'Event id, `<epoch>:<position>`; deduplicate by it',
    },
    source: { type: 'string' },
    type: { type: 'string' },
    subject: { type: 'string', description: 'Artifact id, or the path of a file event' },
    time: { type: 'string', format: 'date-time' },
    datacontenttype: { type: 'string', enum: ['application/json'] },
    dataschema: { type: 'string' },
    partitionkey: {
      type: 'string',
      description: '`repository:<repository>`; events of one partition keep their commit order',
    },
    arkvoryposition: { type: 'string', pattern: decimalPattern },
    arkvoryepoch: { type: 'string', format: 'uuid' },
    data: { type: 'object', description: 'Data of the type; its JSON Schema is in the type list' },
  },
};
const json = (schema: unknown) => ({ 'application/json': { schema } });
const typeSchema = {
  type: 'object',
  required: ['name', 'schemaVersion', 'scope', 'permission', 'partition', 'description'],
  properties: {
    name: { type: 'string' },
    schemaVersion: { type: 'integer', minimum: 1 },
    scope: { type: 'string', enum: ['repository', 'system'] },
    permission: { type: 'string', enum: ['artifact.list', 'administrator'] },
    partition: { type: 'string' },
    description: { type: 'string' },
    dataSchema: { type: 'object' },
  },
};

/** Installation-wide operations; reads, filtered per event by the caller's permissions. */
export const eventOperations = [
  ['/events', 'get', 'listEvents', 'read'],
  ['/events/types', 'get', 'listEventTypes', 'read'],
] as const;

export const eventPaths: Record<string, Record<string, unknown>> = {
  '/api/v1/events': {
    get: {
      summary:
        'Events of the installation after a cursor, oldest first: CloudEvents the caller may see',
      parameters: [
        {
          name: 'after',
          in: 'query',
          schema: { type: 'string', pattern: eventCursorPattern },
          description: 'Event id or next of a page; without it the feed starts at oldest',
        },
        { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500 } },
        {
          name: 'types',
          in: 'query',
          schema: { type: 'string', maxLength: 2048 },
          description: 'Comma-separated names or prefixes such as artifact.*',
        },
        {
          name: 'repository',
          in: 'query',
          schema: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' },
        },
      ],
      responses: {
        200: {
          description: 'Success',
          content: json({
            type: 'object',
            required: ['epoch', 'items', 'next', 'head', 'oldest'],
            properties: {
              epoch: { type: 'string', format: 'uuid' },
              items: { type: 'array', maxItems: 500, items: eventSchema },
              next: { type: 'string', pattern: eventCursorPattern },
              head: { type: 'string', pattern: decimalPattern },
              oldest: { type: 'string', pattern: decimalPattern },
            },
          }),
        },
        409: {
          ...nativeErrorResponse,
          description: 'conflict/events_epoch_changed: the installation was restored; resync',
        },
        410: {
          ...nativeErrorResponse,
          description: 'gone/events_cursor_expired: the cursor is older than oldest; resync',
        },
      },
    },
  },
  '/api/v1/events/types': {
    get: {
      summary: 'Event types of this server with their data schemas',
      responses: {
        200: {
          description: 'Success',
          content: json({
            type: 'object',
            required: ['items'],
            properties: { items: { type: 'array', items: typeSchema } },
          }),
        },
      },
    },
  },
};
