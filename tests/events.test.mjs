import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_EVENT_DATA_BYTES,
  boundEventData,
  catalogEventActions,
  catalogEventDraft,
  eventTypes,
  pruneThrough,
  utf8Length,
} from '@proanima/arkvory-domain';
import {
  EventFeed,
  eventVisibility,
  parseEventCursor,
  parseEventQuery,
  parseEventTypes,
} from '@proanima/arkvory-application';
import {
  cloudEvent,
  eventCatalog,
  eventPageReachedHead,
  openApiDocument,
  readEventPage,
  readNativeError,
} from '@proanima/arkvory-contracts';
import { ArkvoryClient, ArkvoryHttpError } from '@proanima/arkvory-sdk';
import { validateJson } from './api-schema.mjs';
import {
  eventRetryPauseMs,
  readEventRetention,
  runEventSequencer,
} from '../apps/worker/dist/event-loop.js';

const epoch = '0f7d8e3c-1d2b-4a5c-9e8f-0a1b2c3d4e5f';
const artifact = '9a7b6c5d-4e3f-4a1b-8c2d-1e0f9a8b7c6d';
const facts = {
  name: 'game.upack',
  size: '9007199254740993',
  sha256: 'a'.repeat(64),
  labels: ['ci', 'linux'],
  stages: ['release'],
  package: { group: 'studio', name: 'game', version: '1.2.0' },
};
const row = (action, detail = null) => ({
  repository: 'releases',
  artifactId: artifact,
  action,
  detail,
});

test('domain and contracts share one event catalog; every type has a schema, scope and partition', () => {
  const wire = eventCatalog.map(({ name, schemaVersion, scope, permission, partition }) => ({
    name,
    schemaVersion,
    scope,
    permission,
    partition,
  }));
  assert.deepEqual(wire, eventTypes);
  const names = eventTypes.map((type) => type.name);
  assert.equal(new Set(names).size, names.length, 'names are unique');
  assert.equal(new Set(Object.values(catalogEventActions)).size, names.length, 'one action each');
  for (const type of eventCatalog) {
    assert.ok(type.dataSchema.required.includes('artifactId'), type.name);
    assert.ok(openApiDocument.components.schemas[`event.${type.name}.v1`], type.name);
  }
});

test('a journal row becomes its event with descriptor facts, never metadata or the actor', () => {
  const published = catalogEventDraft(row('artifact.publish'), facts);
  assert.deepEqual(published, {
    type: 'artifact.published',
    schemaVersion: 1,
    scope: 'repository',
    repository: 'releases',
    partitionKey: 'repository:releases',
    subject: artifact,
    labels: ['ci', 'linux'],
    data: { repository: 'releases', artifactId: artifact, ...facts },
  });
  const asset = catalogEventDraft(row('asset.restore', 'bin/game.exe'), facts);
  assert.equal(asset.type, 'asset.restored');
  assert.equal(asset.subject, 'bin/game.exe');
  assert.equal(asset.data.path, 'bin/game.exe');
  assert.equal(catalogEventDraft(row('stage.remove', 'qa'), facts).data.stage, 'qa');
  const digest = `sha256:${'b'.repeat(64)}`;
  assert.deepEqual(
    [catalogEventDraft(row('oci.manifest', `app@${digest}`), facts).data].map((d) => [
      d.image,
      d.digest,
    ]),
    [['app', digest]],
  );
  assert.equal(catalogEventDraft(row('oci.tag.delete', 'app:latest'), facts).data.tag, 'latest');
  assert.deepEqual(
    catalogEventDraft(row('npm.tag', '{"name":"@s/p","tag":"next","version":"2.0.0","x":1}'), null)
      .data.npm,
    { name: '@s/p', version: '2.0.0', tag: 'next' },
  );
  assert.equal(
    catalogEventDraft(row('lfs.object', 'c'.repeat(64)), facts).data.oid,
    'c'.repeat(64),
  );
  // References and OCI blobs are plumbing: no event.
  for (const action of ['reference.add', 'reference.remove', 'oci.blob', 'auth.login'])
    assert.equal(catalogEventDraft(row(action), facts), null, action);
  const unknown = catalogEventDraft(row('artifact.delete'), null);
  assert.deepEqual(unknown.data, { repository: 'releases', artifactId: artifact });
});

test('event data stays within 8 KiB: lists go first, then the name; the change itself stays', () => {
  assert.equal(utf8Length('aé€😀'), 1 + 2 + 3 + 4);
  assert.equal(utf8Length('\ud800x'), 4, 'a lone surrogate counts as three bytes');
  const small = { repository: 'r', artifactId: artifact, labels: ['a'] };
  assert.equal(boundEventData(small), small);
  const label = '界'.repeat(64);
  const large = {
    repository: 'r',
    artifactId: artifact,
    name: '名'.repeat(240),
    labels: Array.from({ length: 32 }, () => label),
    stages: Array.from({ length: 16 }, () => label),
    path: '路'.repeat(1024),
  };
  const bounded = boundEventData(large);
  assert.ok(utf8Length(JSON.stringify(bounded)) <= MAX_EVENT_DATA_BYTES);
  assert.equal(bounded.truncated, true);
  assert.equal(bounded.labels, undefined);
  assert.equal(bounded.path, large.path);
  const huge = { ...large, name: '名'.repeat(2000) };
  const reduced = boundEventData(huge);
  assert.equal(reduced.name, undefined);
  assert.equal(reduced.path, large.path);
  assert.ok(utf8Length(JSON.stringify(reduced)) <= MAX_EVENT_DATA_BYTES);
});

test('retention deletes only a prefix of positions: past the row limit or older than the cutoff', () => {
  const batch = [1n, 2n, 3n, 4n].map((position, index) => ({
    position,
    occurredAtMs: [100, 300, 150, 400][index],
  }));
  const at = (retained, maxRows, cutoffMs) => pruneThrough({ batch, retained, maxRows, cutoffMs });
  assert.equal(at(4n, 10n, 0), null, 'nothing is old, nothing is over the limit');
  assert.equal(at(4n, 10n, 200), 1n, 'an old event after a newer one waits for the newer one');
  assert.equal(at(4n, 10n, 500), 4n);
  assert.equal(at(7n, 5n, 0), 2n, 'two over the limit');
  assert.equal(at(7n, 5n, 350), 3n, 'the limit and age together, still a prefix');
  assert.equal(pruneThrough({ batch: [], retained: 0n, maxRows: 1n, cutoffMs: 1e15 }), null);
});

test('the feed query accepts event ids, known types and prefixes, bounded limits', () => {
  assert.deepEqual(parseEventCursor(`${epoch}:9223372036854775807`), {
    epoch,
    position: 9223372036854775807n,
  });
  for (const value of [
    '5',
    `${epoch}:01`,
    `${epoch}:9223372036854775808`,
    `${epoch.toUpperCase()}:1`,
  ])
    assert.throws(
      () => parseEventCursor(value),
      (e) => e.details[0].field === 'after',
      value,
    );
  assert.deepEqual(parseEventTypes('stage.*,artifact.published'), [
    'artifact.published',
    'stage.added',
    'stage.removed',
  ]);
  for (const value of [
    '',
    'artifact.unknown',
    'nothing.*',
    'a,,b',
    Array(33).fill('stage.*').join(','),
  ])
    assert.throws(
      () => parseEventTypes(value),
      (e) => e.details[0].field === 'types',
      value,
    );
  assert.deepEqual(parseEventQuery({}), {
    cursor: null,
    limit: 100,
    types: null,
    repository: null,
  });
  assert.equal(parseEventQuery({ limit: '500' }).limit, 500);
  for (const query of [
    { limit: '0' },
    { limit: '501' },
    { limit: 5 },
    { wait: '1' },
    { after: ['x'] },
  ])
    assert.throws(() => parseEventQuery(query), { code: 'invalid_input' }, JSON.stringify(query));
});

const legacy = (repositories, permissions, extra = {}) => ({
  credential: 'file-key',
  id: 'caller',
  repositories,
  permissions,
  ...extra,
});

test('visibility: list access per repository; system events only for a directly signed-in administrator', () => {
  assert.deepEqual(eventVisibility(legacy(['b', 'a'], ['read'])), {
    repositories: ['a', 'b'],
    system: false,
  });
  assert.deepEqual(
    eventVisibility(legacy(['a'], ['write'])).repositories,
    [],
    'write only: no list',
  );
  assert.equal(eventVisibility(legacy([], [], { administrator: true })).system, true);
  assert.equal(
    eventVisibility(legacy([], [], { administrator: true, credential: 'personal-token' })).system,
    false,
  );
  const managed = {
    ...legacy([], []),
    credential: 'service-key',
    administrator: true,
    managed: {
      keyId: 'k',
      accountId: 'a',
      bindings: [
        { resource: { kind: 'repository', id: 'listed' }, actions: ['artifact.list'] },
        { resource: { kind: 'repository', id: 'content' }, actions: ['content.read'] },
      ],
    },
  };
  assert.deepEqual(eventVisibility(managed), { repositories: ['listed'], system: false });
});

function log(page) {
  const calls = [];
  return {
    calls,
    async read(query) {
      calls.push(query);
      return {
        epoch,
        oldest: 2n,
        head: 40n,
        after: query.after ?? 2n,
        items: [],
        scannedThrough: null,
        ...page,
      };
    },
  };
}
const event = (position) => ({
  position,
  type: 'artifact.published',
  schemaVersion: 1,
  scope: 'repository',
  repository: 'a',
  partitionKey: 'repository:a',
  subject: artifact,
  occurredAt: '2026-10-17T00:00:00.000Z',
  data: { repository: 'a', artifactId: artifact },
});
const caller = legacy(['a'], ['read']);
const query = (extra = {}) => ({ cursor: null, limit: 2, types: null, repository: null, ...extra });

test('the next cursor passes invisible events; epoch and window decide 409, 410 and 400', async () => {
  const scanned = log({ items: [event(7n)], scannedThrough: 5007n });
  const outcome = await new EventFeed(scanned).list(caller, query());
  assert.equal(outcome.next, 5007n, 'a short page moves to the end of the bounded scan');
  assert.deepEqual(scanned.calls[0], {
    after: null,
    limit: 2,
    scan: 5000,
    repositories: ['a'],
    system: false,
    types: null,
  });
  const full = await new EventFeed(
    log({ items: [event(7n), event(9n)], scannedThrough: 30n }),
  ).list(caller, query());
  assert.equal(full.next, 9n, 'a full page continues after its last event');
  const idle = await new EventFeed(log({ after: 40n })).list(
    caller,
    query({ cursor: { epoch, position: 40n } }),
  );
  assert.equal(idle.next, 40n);
  const other = await new EventFeed(log({})).list(
    caller,
    query({ cursor: { epoch: artifact, position: 9n } }),
  );
  assert.deepEqual(other, { kind: 'epoch_changed', window: { epoch, oldest: 2n, head: 40n } });
  const old = await new EventFeed(log({ after: 1n })).list(
    caller,
    query({ cursor: { epoch, position: 1n } }),
  );
  assert.equal(old.kind, 'cursor_expired');
  await assert.rejects(
    new EventFeed(log({ after: 41n })).list(caller, query({ cursor: { epoch, position: 41n } })),
    { code: 'invalid_input' },
  );
  await assert.rejects(new EventFeed(log({})).list(caller, query({ repository: 'b' })), {
    code: 'forbidden',
  });
  const narrowed = log({});
  await new EventFeed(narrowed).list(
    legacy(['a'], ['read'], { administrator: true }),
    query({ repository: 'a' }),
  );
  assert.deepEqual([narrowed.calls[0].repositories, narrowed.calls[0].system], [['a'], false]);
});

test('the CloudEvent envelope round-trips through the strict reader; the error window too', () => {
  const envelope = cloudEvent(
    { ...event(12n), position: '12', repository: 'a b' },
    epoch,
    'Studio Ост',
  );
  assert.equal(envelope.id, `${epoch}:12`);
  assert.equal(envelope.source, '/arkvory/Studio%20%D0%9E%D1%81%D1%82/repositories/a%20b');
  assert.equal(envelope.type, 'arkvory.artifact.published.v1');
  assert.equal(envelope.dataschema, 'urn:arkvory:event:artifact.published:1');
  const page = { epoch, items: [envelope], next: `${epoch}:12`, head: '12', oldest: '0' };
  assert.deepEqual(readEventPage(JSON.parse(JSON.stringify(page))), page);
  assert.throws(() => readEventPage({ ...page, items: [{ ...envelope, id: `${epoch}:13` }] }));
  assert.throws(() => readEventPage({ ...page, items: [{ ...envelope, specversion: '0.3' }] }));
  assert.throws(() => readEventPage({ ...page, next: '12' }));
  const window = { epoch, oldest: '2', head: '9' };
  assert.deepEqual(
    readNativeError({ code: 'gone', requestId: 'r', events: window }).events,
    window,
  );
  assert.equal(readNativeError({ code: 'gone', events: { ...window, head: 9 } }).events, undefined);
});

test('worker retention settings: defaults and bounds of ARKVORY_EVENTS_*', () => {
  assert.deepEqual(readEventRetention({}), { hours: 168, maxRows: 5000000n });
  assert.deepEqual(
    readEventRetention({ ARKVORY_EVENTS_RETENTION_HOURS: '8760', ARKVORY_EVENTS_MAX_ROWS: '1000' }),
    { hours: 8760, maxRows: 1000n },
  );
  for (const [name, value] of [
    ['ARKVORY_EVENTS_RETENTION_HOURS', '0'],
    ['ARKVORY_EVENTS_RETENTION_HOURS', '8761'],
    ['ARKVORY_EVENTS_RETENTION_HOURS', '1.5'],
    ['ARKVORY_EVENTS_MAX_ROWS', '999'],
    ['ARKVORY_EVENTS_MAX_ROWS', '1000000001'],
  ])
    assert.throws(() => readEventRetention({ [name]: value }), new RegExp(name), value);
});

/** An SDK client whose fetch answers from a script of responses. */
function scripted(t, answers) {
  const requests = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    requests.push(new URL(url).search);
    const next = answers.shift();
    if (!next) throw new Error('no more answers');
    return new Response(JSON.stringify(next.body), {
      status: next.status ?? 200,
      headers: { 'content-type': 'application/json', ...(next.headers ?? {}) },
    });
  };
  t.after(() => {
    globalThis.fetch = original;
  });
  return { requests, client: new ArkvoryClient('http://127.0.0.1:1', () => 'key') };
}
const envelopeAt = (position) =>
  cloudEvent({ ...event(position), position: String(position) }, epoch, 'site');

test('SDK follow saves the cursor after each event and past invisible ones; 410 ends it', async (t) => {
  const window = { epoch, oldest: '30', head: '40' };
  const { requests, client } = scripted(t, [
    {
      body: {
        epoch,
        items: [envelopeAt(3), envelopeAt(4)],
        next: `${epoch}:4`,
        head: '9',
        oldest: '0',
      },
    },
    { status: 503, body: { code: 'busy', requestId: 'r' }, headers: { 'retry-after': '0' } },
    { body: { epoch, items: [], next: `${epoch}:9`, head: '9', oldest: '0' } },
    {
      status: 410,
      body: { code: 'gone', reason: 'events_cursor_expired', requestId: 'r', events: window },
    },
  ]);
  const saved = [];
  const seen = [];
  await assert.rejects(
    (async () => {
      for await (const item of client.events.follow({
        after: `${epoch}:2`,
        limit: 2,
        types: ['artifact.*'],
        pollMs: 1,
        save: (cursor) => saved.push(cursor),
      }))
        seen.push(item.arkvoryposition);
    })(),
    (error) =>
      error instanceof ArkvoryHttpError && error.status === 410 && error.events.oldest === '30',
  );
  assert.deepEqual(seen, ['3', '4']);
  assert.deepEqual(saved, [`${epoch}:3`, `${epoch}:4`, `${epoch}:9`]);
  assert.deepEqual(
    requests.map((search) => new URLSearchParams(search).get('after')),
    [`${epoch}:2`, `${epoch}:4`, `${epoch}:4`, `${epoch}:9`],
  );
  assert.equal(new URLSearchParams(requests[0]).get('types'), 'artifact.*');
});

test(
  'SDK follow reads on without a pause until next reaches head',
  { timeout: 10000 },
  async (t) => {
    const { requests, client } = scripted(t, [
      // Only hidden events in the bounded scan: a short page that is not the end.
      { body: { epoch, items: [], next: `${epoch}:5000`, head: '9000', oldest: '0' } },
      {
        body: {
          epoch,
          items: [envelopeAt(9000)],
          next: `${epoch}:9000`,
          head: '9000',
          oldest: '0',
        },
      },
    ]);
    const seen = [];
    for await (const item of client.events.follow({ limit: 100, pollMs: 60000 })) {
      seen.push(item.arkvoryposition);
      break;
    }
    assert.deepEqual(seen, ['9000']);
    assert.equal(requests.length, 2);
    const reached = (next, head) =>
      eventPageReachedHead({ epoch, items: [], next: `${epoch}:${next}`, head, oldest: '0' });
    assert.equal(reached('5000', '9000'), false);
    assert.equal(reached('9000', '9000'), true);
    assert.equal(reached('9223372036854775807', '9223372036854775807'), true);
  },
);

test('a failing sequencer step backs off up to 30 s instead of a warning every tick', async () => {
  assert.deepEqual(
    [1, 2, 5, 6, 1000].map((attempts) => eventRetryPauseMs(attempts, 500)),
    [1000, 2000, 16000, 30000, 30000],
  );
  const records = [];
  const stop = new AbortController();
  const down = Object.assign(new Error('database down'), { code: 'ECONNREFUSED' });
  const loop = runEventSequencer({
    catalog: { pool: { connect: () => Promise.reject(down) }, active: true },
    retention: { hours: 168, maxRows: 1000n },
    stop: stop.signal,
    diagnostics: { write: (record) => records.push(record) },
    tickMs: 10,
  });
  await new Promise((resolve) => setTimeout(resolve, 400));
  stop.abort();
  await loop;
  // Pauses of 20, 40, 80, 160 and 320 ms: a handful of warnings, not one per 10 ms tick.
  assert.ok(records.length >= 2 && records.length <= 6, `${records.length} warnings`);
  assert.ok(records.every((record) => record.code === 'events.step_failed'));
  assert.deepEqual(
    records.map((record) => record.attempts),
    records.map((_, index) => index + 1),
  );
});

test('the data of every event type satisfies the JSON Schema the type list publishes', () => {
  const digest = `sha256:${'b'.repeat(64)}`;
  // The journal detail each writer stores for its action (oci-index, npm-store, lfs-store...).
  const details = {
    'asset.replace': 'bin/game.exe',
    'asset.restore': 'bin/game.exe',
    'stage.add': 'release',
    'stage.remove': 'release',
    'oci.manifest': `app@${digest}`,
    'oci.manifest.delete': `app@${digest}`,
    'oci.tag': 'app:latest',
    'oci.tag.delete': 'app:latest',
    'npm.version': '{"name":"@s/p","version":"2.0.0"}',
    'npm.tag': '{"name":"@s/p","tag":"next","version":"2.0.0"}',
    'npm.tag.delete': '{"name":"@s/p","tag":"next"}',
    'lfs.object': 'c'.repeat(64),
  };
  const schemas = new Map(eventCatalog.map((type) => [type.name, type.dataSchema]));
  for (const action of Object.keys(catalogEventActions))
    for (const known of [facts, null]) {
      const draft = catalogEventDraft(row(action, details[action] ?? null), known);
      validateJson(schemas.get(draft.type), draft.data);
    }
});
