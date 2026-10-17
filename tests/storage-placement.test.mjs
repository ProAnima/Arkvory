import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import {
  ArkvoryError,
  BACKEND_WRITE_STATES,
  decidePlacement,
  parsePlacementRules,
  parsePlacementUpdate,
  placementRulesWire,
  STORAGE_BACKEND_ID,
} from '@proanima/arkvory-domain';
import {
  PlacementControl,
  PolicyPlacement,
  StorageService,
  partsBackendOf,
} from '@proanima/arkvory-application';

const context = { repository: 'releases', packageGroup: 'models/nlp', size: 10 };
const rules = [
  { id: 'models', backendId: 'volume-2', packageGroup: 'models/*' },
  { id: 'large', backendId: 'volume-3', minSizeBytes: 1000 },
];

test('placement: every state of the chosen storage, and only `accepting` keeps the choice', () => {
  for (const state of BACKEND_WRITE_STATES) {
    const decision = decidePlacement(rules, context, (id) => {
      assert.equal(id, 'volume-2', 'only the chosen storage is asked');
      return state;
    });
    if (state === 'accepting')
      assert.deepEqual(decision, { backendId: 'volume-2', requested: 'volume-2', fallback: null });
    else
      assert.deepEqual(decision, { backendId: 'default', requested: 'volume-2', fallback: state });
  }
  // Rules are tried in order; the first match wins even when a later one would also match.
  assert.equal(
    decidePlacement(rules, { ...context, size: 5000 }, () => 'accepting').backendId,
    'volume-2',
  );
  assert.equal(
    decidePlacement(rules, { repository: 'r', size: 5000 }, () => 'accepting').backendId,
    'volume-3',
  );
  // No rule: the core's storage, which is never asked and never falls back.
  assert.deepEqual(
    decidePlacement(rules, { repository: 'r', size: 1 }, () => assert.fail('not asked')),
    { backendId: 'default', requested: 'default', fallback: null },
  );
  assert.deepEqual(
    decidePlacement([{ id: 'x', backendId: 'default' }], context, () => assert.fail('not asked')),
    { backendId: 'default', requested: 'default', fallback: null },
  );
});

test('placement rules: wire form round trip, bounds and JSON Pointer of the refused field', () => {
  const wire = [
    { id: 'models', backendId: 'volume-2', packageGroup: 'models/*', minSizeBytes: null },
    { id: 'big', backendId: 'mod.cold', packageGroup: null, minSizeBytes: '9007199254740991' },
  ];
  const parsed = parsePlacementRules(wire);
  assert.deepEqual(parsed, [
    { id: 'models', backendId: 'volume-2', packageGroup: 'models/*' },
    { id: 'big', backendId: 'mod.cold', minSizeBytes: 9007199254740991 },
  ]);
  assert.deepEqual(placementRulesWire(parsed), wire);
  assert.deepEqual(parsePlacementUpdate({ expectedRevision: 3, rules: [] }), {
    expectedRevision: 3,
    rules: [],
  });
  const refused = (value, field) =>
    assert.throws(
      () => parsePlacementRules(value),
      (error) =>
        error instanceof ArkvoryError &&
        error.code === 'invalid_input' &&
        error.details.some((detail) => detail.field === field),
    );
  const rule = wire[0];
  refused([{ ...rule, backendId: 'Volume' }], '/rules/0/backendId');
  refused([rule, { ...rule, id: 'x', minSizeBytes: '9007199254740992' }], '/rules/1/minSizeBytes');
  refused([{ ...rule, minSizeBytes: 5 }], '/rules/0/minSizeBytes');
  refused([{ ...rule, packageGroup: 'a\nb' }], '/rules/0/packageGroup');
  // The wire allows 256 characters: a group of 255 with `/*` is not stored.
  parsePlacementRules([{ ...rule, packageGroup: 'g'.repeat(254) + '/*' }]);
  refused([{ ...rule, packageGroup: 'g'.repeat(255) + '/*' }], '/rules/0/packageGroup');
  refused([{ ...rule, id: '' }], '/rules/0/id');
  refused([rule, rule], '/rules');
  refused(
    Array.from({ length: 33 }, (_, i) => ({ ...rule, id: `r${String(i)}` })),
    '/rules',
  );
  assert.throws(() => parsePlacementRules([{ ...rule, extra: 1 }]), { code: 'invalid_input' });
  assert.throws(() => parsePlacementUpdate({ rules: [] }), { code: 'invalid_input' });
  for (const id of ['default', 'volume-2', 'module.name', 'a'.repeat(64)])
    assert.ok(STORAGE_BACKEND_ID.test(id), id);
  for (const id of ['', 'A', '2x', 'a.b.c', 'a'.repeat(65), 'a..b', '../x'])
    assert.ok(!STORAGE_BACKEND_ID.test(id), id);
});

const states = (map) => ({
  ids: () => ['default', ...Object.keys(map)],
  state: (id) => (id === 'default' ? 'accepting' : (map[id] ?? 'not_loaded')),
});

test('policy placement reads the repository rules and reports each fallback once', async () => {
  const told = [];
  const placement = new PolicyPlacement(
    { get: async (repository) => ({ repository, revision: 1, rules }) },
    states({ 'volume-2': 'disabled' }),
    (decision, repository) => told.push([repository, decision.fallback]),
  );
  assert.equal((await placement.place(context)).backendId, 'default');
  assert.equal((await placement.place({ repository: 'r', size: 1 })).backendId, 'default');
  assert.deepEqual(told, [['releases', 'disabled']]);
  assert.equal(placement.state('volume-2'), 'disabled');
});

test('placement control: storage rights, unknown storages refused, every storage listed', async () => {
  const saved = [];
  const control = new PlacementControl(
    {
      get: async (repository) => ({
        repository,
        revision: saved.length,
        rules: saved.at(-1) ?? [],
        updatedBy: null,
        updatedAt: null,
      }),
      save: async (access, expected, list) => {
        assert.deepEqual(access.actions, ['storage.manage']);
        assert.equal(expected, saved.length);
        saved.push(list);
        return { repository: access.repository, revision: saved.length, rules: list };
      },
    },
    states({ 'volume-2': 'not_accepting' }),
  );
  const managed = (actions) => ({
    id: 'service:s',
    repositories: ['releases'],
    permissions: [],
    managed: {
      accountId: 'a',
      keyId: 'k',
      bindings: [{ resource: { kind: 'repository', id: 'releases' }, actions }],
    },
  });
  const manager = managed(['storage.read', 'storage.manage']);
  const view = await control.get(manager, 'releases');
  assert.deepEqual(view.backends, [
    { id: 'default', state: 'accepting' },
    { id: 'volume-2', state: 'not_accepting' },
  ]);
  // A storage that takes no data now may still be named: it is skipped per upload.
  const rule = { id: 'm', backendId: 'volume-2', packageGroup: null, minSizeBytes: null };
  assert.equal(
    (await control.save(manager, 'releases', { expectedRevision: 0, rules: [rule] })).revision,
    1,
  );
  await assert.rejects(
    control.save(manager, 'releases', {
      expectedRevision: 1,
      rules: [rule, { ...rule, id: 'n', backendId: 'volume-9' }],
    }),
    (error) =>
      error.code === 'invalid_input' &&
      error.reason === 'backend_unknown' &&
      error.details[0].field === '/rules/1/backendId',
  );
  await assert.rejects(
    control.save(managed(['storage.read']), 'releases', { expectedRevision: 1, rules: [] }),
    {
      code: 'forbidden',
    },
  );
  // Password accounts and the recovery key have no storage rights, as for the storage policy.
  await assert.rejects(
    control.get(
      { id: 'user:a', repositories: ['releases'], permissions: ['read', 'write'] },
      'releases',
    ),
    { code: 'forbidden' },
  );
});

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const writer = { id: 'k', repositories: ['r'], permissions: ['read', 'write'] };

/** A catalog of one upload in memory with the mutation protocol of the real one. */
function memoryCatalog(upload, parts = []) {
  const state = { upload, parts: [...parts], relocations: [] };
  return {
    state,
    async get() {
      return state.upload;
    },
    async parts() {
      return state.parts;
    },
    async part(_id, index) {
      return state.parts.find((part) => part.index === index) ?? null;
    },
    async exclusive(_id, action) {
      return action({
        throwIfAborted() {},
        async recordPart(part) {
          state.parts.push(part);
        },
        async relocate(storageBackend, partsBackend) {
          state.relocations.push([storageBackend, partsBackend]);
          state.upload = {
            ...state.upload,
            storageBackend,
            ...(partsBackend === null || state.upload.partsBackend ? {} : { partsBackend }),
          };
          return state.upload;
        },
        async publish() {
          state.upload = { ...state.upload, status: 'available' };
          return state.upload;
        },
      });
    },
  };
}

function recordingBlobs(held = new Set()) {
  const calls = [];
  return {
    calls,
    /** Objects of earlier attempts, as `storage/id`; every other object is missing. */
    async exists(id, _size, backendId) {
      if (!held.has(`${backendId}/${id}`))
        throw Object.assign(new Error('missing'), { code: 'unavailable' });
    },
    async put(id, _descriptor, source, _cancellation, backendId) {
      for await (const chunk of source) assert.ok(chunk);
      calls.push(['put', backendId]);
    },
    async putPart(_id, part, _source, _cancellation, backendId) {
      calls.push(['putPart', backendId, part.index]);
    },
    async *readParts(_id, _parts, backendId) {
      calls.push(['readParts', backendId]);
      yield Buffer.from('abc');
    },
    async verify(_id, _descriptor, _cancellation, backendId) {
      calls.push(['verify', backendId]);
    },
  };
}

function upload(storageBackend, size = 3) {
  const bytes = Buffer.from('abc');
  return {
    id: randomUUID(),
    repository: 'r',
    owner: 'k',
    status: 'pending',
    createdAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2999-01-01T00:00:00.000Z',
    storageBackend,
    partBytes: 8388608,
    descriptor: { name: 'a', size, sha256: sha(bytes), labels: [], metadata: {} },
  };
}

function service(catalog, blobs, map) {
  return new StorageService(
    catalog,
    blobs,
    { next: randomUUID, now: () => '2026-01-02T00:00:00.000Z' },
    { placement: new PolicyPlacement({ get: async () => ({ rules: [] }) }, states(map)) },
  );
}

const done = { throwIfAborted() {} };
const part = { index: 0, size: 3, sha256: sha(Buffer.from('abc')) };

test('an upload whose storage stopped taking data finishes in default, parts read where they are', async () => {
  for (const state of ['not_accepting', 'read_only', 'disabled', 'not_loaded']) {
    const pending = upload('volume-2');
    const catalog = memoryCatalog(pending, [part]);
    const blobs = recordingBlobs();
    const result = await service(catalog, blobs, { 'volume-2': state }).complete(
      writer,
      'r',
      pending.id,
      done,
    );
    // The switch is recorded before the object is written: a retry writes to the same storage.
    assert.deepEqual(catalog.state.relocations, [['default', 'volume-2']], state);
    assert.deepEqual(
      blobs.calls,
      [
        ['readParts', 'volume-2'],
        ['put', 'default'],
      ],
      state,
    );
    assert.equal(result.storageBackend, 'default');
    assert.equal(partsBackendOf(result), 'volume-2');
  }
  // A retry after the switch reads the parts from their storage again, no second switch.
  const retried = { ...upload('default'), partsBackend: 'volume-2' };
  const catalog = memoryCatalog(retried, [part]);
  const blobs = recordingBlobs();
  await service(catalog, blobs, { 'volume-2': 'not_accepting' }).complete(
    writer,
    'r',
    retried.id,
    done,
  );
  assert.deepEqual(catalog.state.relocations, []);
  assert.deepEqual(blobs.calls, [
    ['readParts', 'volume-2'],
    ['put', 'default'],
  ]);
});

test('a passing outage is not a switch, and an accepting storage keeps its upload', async () => {
  for (const state of ['accepting', 'unavailable']) {
    const pending = upload('volume-2');
    const catalog = memoryCatalog(pending, [part]);
    const blobs = recordingBlobs();
    await service(catalog, blobs, { 'volume-2': state }).complete(writer, 'r', pending.id, done);
    assert.deepEqual(catalog.state.relocations, [], state);
    assert.deepEqual(
      blobs.calls,
      [
        ['readParts', 'volume-2'],
        ['put', 'volume-2'],
      ],
      state,
    );
  }
});

test('new parts of an upload whose storage refuses data are backend_read_only', async () => {
  const pending = upload('volume-2');
  const catalog = memoryCatalog(pending);
  const blobs = recordingBlobs();
  const storage = service(catalog, blobs, { 'volume-2': 'not_accepting' });
  await assert.rejects(
    storage.uploadPart(writer, 'r', pending.id, 0, part.sha256, (async function* () {})(), done),
    { code: 'conflict', reason: 'backend_read_only' },
  );
  assert.deepEqual(blobs.calls, []);
  // Parts left behind a switch stay where they are: their storage decides, not the new one.
  const switched = memoryCatalog({ ...upload('default'), partsBackend: 'volume-2' });
  await assert.rejects(
    storage.uploadPart(
      writer,
      'r',
      switched.state.upload.id,
      0,
      part.sha256,
      (async function* () {})(),
      done,
    ),
    { reason: 'backend_read_only' },
  );
  const open = memoryCatalog(upload('volume-2'));
  await service(open, blobs, { 'volume-2': 'accepting' }).uploadPart(
    writer,
    'r',
    open.state.upload.id,
    0,
    part.sha256,
    (async function* () {})(),
    done,
  );
  assert.deepEqual(blobs.calls, [['putPart', 'volume-2', 0]]);
});

test('a whole-body upload to a storage that refuses data is written to default, nothing moves', async () => {
  const pending = upload('volume-2');
  const catalog = memoryCatalog(pending);
  const blobs = recordingBlobs();
  const result = await service(catalog, blobs, { 'volume-2': 'read_only' }).upload(
    writer,
    'r',
    pending.id,
    (async function* () {
      yield Buffer.from('abc');
    })(),
    done,
  );
  assert.deepEqual(catalog.state.relocations, [['default', null]]);
  assert.deepEqual(blobs.calls, [['put', 'default']]);
  assert.equal(result.storageBackend, 'default');
  assert.equal(result.partsBackend, undefined);
});

test('an object written before a stop keeps its storage: a retry does not orphan it', async () => {
  // The whole object reached volume-2, the process stopped before publication, and volume-2
  // took no new data any more when the client retried. Writing it again in default would
  // leave the first copy in volume-2 without an upload row that cleanup could follow.
  for (const state of ['not_accepting', 'read_only']) {
    const pending = upload('volume-2');
    const catalog = memoryCatalog(pending, [part]);
    const blobs = recordingBlobs(new Set([`volume-2/${pending.id}`]));
    const result = await service(catalog, blobs, { 'volume-2': state }).complete(
      writer,
      'r',
      pending.id,
      done,
    );
    assert.deepEqual(catalog.state.relocations, [], state);
    assert.deepEqual(blobs.calls, [['verify', 'volume-2']], state);
    assert.equal(result.storageBackend, 'volume-2');
    assert.equal(result.status, 'available');
  }
  const whole = upload('volume-2');
  const catalog = memoryCatalog(whole);
  const blobs = recordingBlobs(new Set([`volume-2/${whole.id}`]));
  await service(catalog, blobs, { 'volume-2': 'not_accepting' }).upload(
    writer,
    'r',
    whole.id,
    (async function* () {
      yield Buffer.from('abc');
    })(),
    done,
  );
  assert.deepEqual(catalog.state.relocations, []);
  assert.deepEqual(blobs.calls, [['put', 'volume-2']]);
});

test('a new upload is created in the storage its placement chose, or in default', async () => {
  const created = [];
  const catalog = {
    async create(input) {
      created.push(input.storageBackend);
      return { ...input, status: 'pending' };
    },
  };
  const placement = new PolicyPlacement(
    { get: async () => ({ rules: [{ id: 'all', backendId: 'volume-2' }] }) },
    {
      ids: () => ['default', 'volume-2'],
      state: () => current,
    },
  );
  let current = 'accepting';
  const storage = new StorageService(
    catalog,
    recordingBlobs(),
    { next: randomUUID, now: () => 'n' },
    { placement },
  );
  const descriptor = { name: 'a', size: '3', sha256: sha(Buffer.from('abc')) };
  await storage.create(writer, 'r', 'key-1', descriptor);
  current = 'unavailable';
  await storage.create(writer, 'r', 'key-2', descriptor);
  assert.deepEqual(created, ['volume-2', 'default']);
  // Without placement everything stays in default, as before storages were named.
  const plain = new StorageService(catalog, recordingBlobs(), { next: randomUUID, now: () => 'n' });
  await plain.create(writer, 'r', 'key-3', descriptor);
  assert.equal(created.at(-1), 'default');
});
