import { lfsObjectAction } from './lfs.js';
import { npmFeedActions } from './npm.js';
import { ociFeedActions, parseOciDetail } from './oci.js';

/**
 * Events for external systems (ADR 0080): the catalog of event types and the pure rules that
 * turn a catalog journal row into an event. The wire schemas live in contracts; a unit test
 * keeps both catalogs equal, because contracts never depend on domain.
 */
export const MAX_EVENT_DATA_BYTES = 8192;
/** Unsequenced rows the sequencer numbers in one transaction. */
export const EVENT_SEQUENCE_BATCH = 1000;
/** Rows one read of the event feed looks at, visible to the caller or not. */
export const EVENT_SCAN_ROWS = 5000;

export type EventScope = 'repository' | 'system';
export interface EventTypeEntry {
  readonly name: string;
  readonly schemaVersion: number;
  readonly scope: EventScope;
  /** What a reader needs: the action on the event's repository, or global administration. */
  readonly permission: 'artifact.list' | 'administrator';
  /** Ordered stream: one per repository (`repository:<r>`), or `system:<source>`. */
  readonly partition: 'repository' | `system:${string}`;
}

/**
 * Journal action → event type. Actions not listed (references, OCI blobs) are plumbing of
 * retention and registries and produce no event; a journal row never produces two events.
 */
export const catalogEventActions: Readonly<Record<string, string>> = {
  'artifact.publish': 'artifact.published',
  'artifact.delete': 'artifact.deleted',
  'asset.replace': 'asset.revision.created',
  'asset.restore': 'asset.restored',
  'package.register': 'package.registered',
  'annotations.replace': 'annotation.updated',
  'attachments.replace': 'attachments.updated',
  'stage.add': 'stage.added',
  'stage.remove': 'stage.removed',
  'artifact.promote': 'artifact.promoted',
  'artifact.receive': 'artifact.received',
  [ociFeedActions.manifest]: 'oci.manifest.pushed',
  [ociFeedActions.manifestDeleted]: 'oci.manifest.deleted',
  [ociFeedActions.tag]: 'oci.tag.updated',
  [ociFeedActions.tagDeleted]: 'oci.tag.deleted',
  [npmFeedActions.version]: 'npm.version.published',
  [npmFeedActions.tag]: 'npm.tag.updated',
  [npmFeedActions.tagDeleted]: 'npm.tag.deleted',
  [lfsObjectAction]: 'lfs.object.stored',
};

export const eventTypes: readonly EventTypeEntry[] = Object.values(catalogEventActions).map(
  (name) => ({
    name,
    schemaVersion: 1,
    scope: 'repository',
    permission: 'artifact.list',
    partition: 'repository',
  }),
);
export const eventTypeNames: readonly string[] = eventTypes.map((type) => type.name);

/** Facts of the artifact a journal row names, as the catalog holds them in its transaction. */
export interface ArtifactFacts {
  readonly name: string;
  /** Decimal string: sizes are 64-bit. */
  readonly size: string;
  readonly sha256: string;
  readonly labels: readonly string[];
  readonly stages: readonly string[];
  /** UPack registration of the artifact, when it has one. */
  readonly package: {
    readonly group: string;
    readonly name: string;
    readonly version: string;
  } | null;
}
export interface JournalRow {
  readonly repository: string;
  readonly artifactId: string;
  readonly action: string;
  readonly detail: string | null;
}
/** An event before the sequencer gives it a position. */
export interface EventDraft {
  readonly type: string;
  readonly schemaVersion: number;
  readonly scope: EventScope;
  readonly repository: string | null;
  readonly partitionKey: string;
  readonly subject: string;
  readonly labels: readonly string[];
  readonly data: Readonly<Record<string, unknown>>;
}

/** UTF-8 length of a string without a platform encoder (domain has no Node or DOM globals). */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index++;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

function jsonObject(text: string | null): Record<string, unknown> | null {
  if (text === null) return null;
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value))
      : null;
  } catch {
    return null;
  }
}

/** Fields of the journal detail by action: a path, a stage, an image reference or a package. */
function detailFields(action: string, detail: string | null): Record<string, unknown> {
  if (detail === null) return {};
  switch (action) {
    case 'asset.replace':
    case 'asset.restore':
      return { path: detail };
    case 'stage.add':
    case 'stage.remove':
      return { stage: detail };
    case lfsObjectAction:
      return { oid: detail };
    case ociFeedActions.manifest:
    case ociFeedActions.manifestDeleted:
    case ociFeedActions.tag:
    case ociFeedActions.tagDeleted:
      return { ...(parseOciDetail(detail) ?? {}) };
    case npmFeedActions.version:
    case npmFeedActions.tag:
    case npmFeedActions.tagDeleted: {
      const npm = jsonObject(detail);
      if (!npm) return {};
      const pick = ['name', 'version', 'tag'].filter((key) => typeof npm[key] === 'string');
      return { npm: Object.fromEntries(pick.map((key) => [key, npm[key]])) };
    }
    default:
      return {};
  }
}

function artifactFields(facts: ArtifactFacts | null): Record<string, unknown> {
  if (!facts) return {};
  return {
    name: facts.name,
    size: facts.size,
    sha256: facts.sha256,
    labels: [...facts.labels],
    stages: [...facts.stages],
    ...(facts.package ? { package: { ...facts.package } } : {}),
  };
}

const without = (data: Record<string, unknown>, keys: readonly string[]) => ({
  ...Object.fromEntries(Object.entries(data).filter(([key]) => !keys.includes(key))),
  truncated: true,
});

/**
 * Keeps `data` within MAX_EVENT_DATA_BYTES. Every catalog value is bounded (32 labels, 16
 * stages, 240-character names, 1024-character paths), so only extreme Unicode reaches the
 * limit. Then the label and stage lists go first, the name and package next; the identifiers
 * and the fields of the change itself always stay. `truncated` tells the consumer to read the
 * rest through the API.
 */
export function boundEventData(data: Record<string, unknown>): Record<string, unknown> {
  if (utf8Length(JSON.stringify(data)) <= MAX_EVENT_DATA_BYTES) return data;
  const reduced = without(data, ['labels', 'stages']);
  if (utf8Length(JSON.stringify(reduced)) <= MAX_EVENT_DATA_BYTES) return reduced;
  return without(data, ['labels', 'stages', 'name', 'package']);
}

/**
 * The event of one journal row, or null for an action without one. `data` holds identifiers
 * and descriptor facts only: never the actor, metadata values, secrets or bytes (ADR 0080).
 */
export function catalogEventDraft(row: JournalRow, facts: ArtifactFacts | null): EventDraft | null {
  const type = catalogEventActions[row.action];
  if (type === undefined) return null;
  const details = detailFields(row.action, row.detail);
  const path = details['path'];
  const data = boundEventData({
    repository: row.repository,
    artifactId: row.artifactId,
    ...artifactFields(facts),
    ...details,
  });
  return {
    type,
    schemaVersion: 1,
    scope: 'repository',
    repository: row.repository,
    partitionKey: `repository:${row.repository}`,
    subject: typeof path === 'string' ? path : row.artifactId,
    labels: facts ? [...facts.labels] : [],
    data,
  };
}

/** A retained, sequenced event as retention sees it: position and commit-time age. */
export interface RetainedEvent {
  readonly position: bigint;
  readonly occurredAtMs: number;
}
export interface EventRetention {
  /** The oldest retained sequenced events in position order. */
  readonly batch: readonly RetainedEvent[];
  /** Sequenced events retained in total. */
  readonly retained: bigint;
  readonly maxRows: bigint;
  /** Events that occurred before this instant may go. */
  readonly cutoffMs: number;
}

/**
 * The highest position retention may delete through, or null. Only a prefix of positions goes:
 * a cursor is then expired exactly when it is below the pruned position, and no consumer sees a
 * hole in the middle of the window. An event goes when it is beyond the row limit or too old.
 */
export function pruneThrough(retention: EventRetention): bigint | null {
  const excess = retention.retained - retention.maxRows;
  let through: bigint | null = null;
  for (const [index, event] of retention.batch.entries()) {
    if (BigInt(index) >= excess && event.occurredAtMs >= retention.cutoffMs) break;
    through = event.position;
  }
  return through;
}
