import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import {
  LocalBlobStore,
  StorageBackends,
  localStorageBackends,
  localStorageSettings,
  parseLocalStorageConfig,
  probeStorageBackends,
  requireReplicatedVolumes,
  storageChangeRecord,
  builtinModules,
} from '@proanima/arkvory-infrastructure';
import { PlacementControl } from '@proanima/arkvory-application';
import { ModuleConfigError } from '@proanima/arkvory-extension-api';
import { removeTestDirectory } from './helpers.mjs';
import { initializeVolume } from '../apps/deploy/dist/storage-volume.js';
import { storageBackendContract } from './contracts/storage-backend.mjs';
import { DirectoryBackend } from './contracts/directory-backend.mjs';
import { MemoryBlobStore } from './memory-blobs.mjs';

async function directory(t, prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => removeTestDirectory(root));
  return root;
}
const instance = (id, store, extra = {}) => ({
  id,
  blobs: store,
  lifecycle: store,
  mode: 'full',
  acceptsWrites: true,
  enabled: true,
  ...extra,
});

// The same contract for the core's storage, the test storage without paths, and both behind
// the storages of a process under another id (LSP: what the core relies on holds for each).
storageBackendContract('local-storage', async (t) => {
  const root = await directory(t, 'arkvory-contract-local-');
  const make = () => {
    const store = new LocalBlobStore(root, 0);
    return { blobs: store, lifecycle: store };
  };
  return { ...make(), reopen: make };
});
storageBackendContract('directory-backend', async (t) => {
  const root = await directory(t, 'arkvory-contract-dir-');
  const make = () => {
    const store = new DirectoryBackend(root);
    return { blobs: store, lifecycle: store };
  };
  return { ...make(), reopen: make };
});
for (const [name, Store] of [
  ['local-storage', LocalBlobStore],
  ['directory-backend', DirectoryBackend],
])
  storageBackendContract(`${name} as volume-2 of the process`, async (t) => {
    const [core, second] = [
      await directory(t, 'arkvory-contract-core-'),
      await directory(t, 'arkvory-contract-v2-'),
    ];
    // Usable once opened, with the identity it proved, as after `probeStorageBackends`; a
    // reopened handle knows the identity proven before.
    let proven;
    const make = () => {
      const store = new Store(second, 0);
      const backends = new StorageBackends([
        instance('default', new LocalBlobStore(core, 0)),
        instance('volume-2', store),
      ]);
      if (proven !== undefined) backends.mark('volume-2', null, proven);
      const opened = async () => {
        await store.initialize();
        proven = await store.identity();
        backends.mark('volume-2', null, proven);
      };
      const lifecycle = {
        initialize: opened,
        ready: () => store.ready(),
        identity: (readOnly) => store.identity(readOnly),
        checkSpace: (bytes) => store.checkSpace(bytes),
        requireEmpty: () => store.requireEmpty(),
      };
      return { blobs: backends, lifecycle, backendId: 'volume-2' };
    };
    return { ...make(), reopen: make };
  });

const cancellation = { throwIfAborted() {} };
const bytes = Buffer.from('placed content');
const descriptor = {
  name: 'a',
  size: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  labels: [],
  metadata: {},
};
async function* once() {
  yield bytes;
}

test('each call goes to exactly the named storage: no probing, no fallback to default', async () => {
  const core = new MemoryBlobStore();
  const second = new MemoryBlobStore();
  const backends = new StorageBackends([instance('default', core), instance('volume-2', second)]);
  const id = randomUUID();
  // Not opened yet: unavailable for reads and writes, busy for cleanup.
  assert.equal(backends.state('volume-2'), 'unavailable');
  await assert.rejects(backends.put(id, descriptor, once(), cancellation, 'volume-2'), {
    code: 'unavailable',
  });
  await assert.rejects(backends.collect(id, true, cancellation, 'volume-2'), { code: 'busy' });
  backends.mark('volume-2', null, await second.identity());
  await backends.put(id, descriptor, once(), cancellation, 'volume-2');
  assert.equal(second.has(id), true);
  assert.equal(core.has(id), false);
  // The default storage does not answer for a blob of volume-2, and an unknown id is no alias.
  await assert.rejects(backends.exists(id, bytes.length), { code: 'unavailable' });
  await assert.rejects(backends.exists(id, bytes.length, 'volume-3'), { code: 'unavailable' });
  assert.equal(backends.state('volume-3'), 'not_loaded');
  // Reads are lazy: an unusable storage fails the first read, not the call.
  backends.mark('volume-2', 'probe_failed');
  const reading = backends.read(id, bytes.length, undefined, 'volume-2');
  await assert.rejects(reading[Symbol.asyncIterator]().next(), { code: 'unavailable' });
  assert.deepEqual(backends.status(), [
    { id: 'default', state: 'accepting', fault: null },
    { id: 'volume-2', state: 'unavailable', fault: 'probe_failed' },
  ]);
});

test('read-only serves reads and refuses writes; not accepting still finishes its uploads', async () => {
  const id = randomUUID();
  const frozen = new MemoryBlobStore();
  frozen.place(id, bytes, 'archive');
  const [draining, off] = [new MemoryBlobStore(), new MemoryBlobStore()];
  const backends = new StorageBackends([
    instance('default', new MemoryBlobStore()),
    instance('archive', frozen, { mode: 'read-only' }),
    instance('draining', draining, { acceptsWrites: false }),
    instance('off', off, { enabled: false }),
  ]);
  for (const [id, store] of [
    ['archive', frozen],
    ['draining', draining],
    ['off', off],
  ])
    backends.mark(id, null, await store.identity());
  assert.deepEqual(
    backends.status().map(({ id, state }) => [id, state]),
    [
      ['default', 'accepting'],
      ['archive', 'read_only'],
      ['draining', 'not_accepting'],
      ['off', 'disabled'],
    ],
  );
  await backends.verify(id, descriptor, cancellation, 'archive');
  await assert.rejects(backends.put(randomUUID(), descriptor, once(), cancellation, 'archive'), {
    code: 'read_only',
  });
  await assert.rejects(backends.collect(id, true, cancellation, 'archive'), { code: 'busy' });
  // Placement decides about new uploads; the storage still writes what it is given.
  await backends.put(randomUUID(), descriptor, once(), cancellation, 'draining');
  await assert.rejects(backends.exists(id, 1, 'off'), { code: 'unavailable' });
  assert.throws(
    () => new StorageBackends([instance('default', new MemoryBlobStore(), { mode: 'read-only' })]),
    { code: 'invalid_input' },
  );
  assert.throws(() => new StorageBackends([instance('volume-2', new MemoryBlobStore())]), {
    code: 'invalid_input',
  });
});

test('local-storage settings: instances by id, defaults, field paths, overlapping directories', async (t) => {
  const data = await directory(t, 'arkvory-settings-');
  const second = join(data + '-second');
  assert.deepEqual(parseLocalStorageConfig(undefined), { instances: [] });
  assert.deepEqual(parseLocalStorageConfig({ instances: { 'volume-2': { directory: second } } }), {
    instances: [
      {
        id: 'volume-2',
        directory: second,
        enabled: true,
        mode: 'full',
        acceptsWrites: true,
        reserveBytes: undefined,
      },
    ],
  });
  const refused = (config, code, path) =>
    assert.throws(
      () => parseLocalStorageConfig(config),
      (error) => error instanceof ModuleConfigError && error.code === code && error.path === path,
    );
  refused({ instances: { default: { directory: second } } }, 'format', '/instances');
  refused({ instances: { 'a.b': { directory: second } } }, 'format', '/instances');
  refused({ instances: { v: {} } }, 'required', '/instances/v/directory');
  refused({ instances: { v: { directory: 'relative' } } }, 'format', '/instances/v/directory');
  refused(
    { instances: { v: { directory: second, mode: 'cold' } } },
    'invalid',
    '/instances/v/mode',
  );
  refused(
    { instances: { v: { directory: second, acceptsWrites: 1 } } },
    'type',
    '/instances/v/acceptsWrites',
  );
  refused(
    { instances: { v: { directory: second, reserveBytes: -1 } } },
    'range',
    '/instances/v/reserveBytes',
  );
  refused(
    { instances: { v: { directory: second, size: 1 } } },
    'unknown_field',
    '/instances/v/size',
  );
  refused({ volumes: {} }, 'unknown_field', '/volumes');
  // Overlap with the data directory or another instance is refused with the field, no path.
  const inside = (directory) => ({ enabled: true, config: { instances: { v: { directory } } } });
  assert.throws(
    () => localStorageSettings(inside(join(data, 'nested')), data),
    (error) =>
      /overlapping \/modules\/local-storage\/config\/instances\/v\/directory$/.test(error.message),
  );
  assert.throws(
    () =>
      localStorageSettings(
        {
          enabled: true,
          config: { instances: { a: { directory: second }, b: { directory: join(second, 'b') } } },
        },
        data,
      ),
    /instances\/b\/directory/,
  );
  // The plan sees which storages exist and how they take writes, not where this host mounts them.
  const module = builtinModules('1.0.0').find((d) => d.manifest.id === 'local-storage');
  assert.equal(module.manifest.kind, 'storage-backend');
  assert.equal(module.manifest.core, true);
  assert.deepEqual(module.describeConfig(module.parseConfig(undefined)), {});
  assert.deepEqual(
    module.describeConfig(
      module.parseConfig({
        instances: { 'volume-2': { directory: second, acceptsWrites: false } },
      }),
    ),
    { instances: { 'volume-2': { enabled: true, mode: 'full', acceptsWrites: false } } },
  );
});

/** Identity records of a database in memory. */
function records() {
  const map = new Map();
  return {
    map,
    async recorded(id) {
      return map.get(id) ?? null;
    },
    async record(id, storageId) {
      if (!map.has(id)) map.set(id, storageId);
      return map.get(id);
    },
    async known() {
      return [...map.keys()].sort();
    },
  };
}

/** `arkvory volume-init` on the host, for a temporary directory that is no mount point. */
const volumeInit = (directory) => initializeVolume({ directory, expectMount: false });

test('opening a storage proves its identity: the writer records it, others wait for it', async (t) => {
  const data = await directory(t, 'arkvory-probe-core-');
  const second = await directory(t, 'arkvory-probe-v2-');
  const settings = [
    { id: 'volume-2', directory: second, enabled: true, mode: 'full', acceptsWrites: true },
  ];
  const known = records();
  const changes = [];
  const changed = (id, fault) => changes.push([id, fault]);
  // A reader or the worker never creates a storage the writer has not recorded.
  const reader = localStorageBackends(data, 0, settings);
  await probeStorageBackends(reader, known, { create: false, changed });
  assert.equal(reader.fault('volume-2'), 'identity_unknown');
  // No process makes a volume: without `arkvory volume-init` it stays unavailable, untouched.
  const writer = localStorageBackends(data, 0, settings);
  await probeStorageBackends(writer, known, { create: true, changed });
  assert.equal(writer.fault('volume-2'), 'not_initialized');
  assert.deepEqual(await readdir(second), []);
  assert.equal(known.map.size, 0);
  // Marked on the host: the writer records its identity and lays it out inside.
  await volumeInit(second);
  await probeStorageBackends(writer, known, { create: true, changed });
  assert.equal(writer.state('volume-2'), 'accepting');
  assert.deepEqual((await readdir(second)).sort(), ['blobs', 'parts', 'staging', 'storage-id']);
  assert.equal(known.map.size, 1);
  await probeStorageBackends(reader, known, { create: false, changed });
  assert.equal(reader.state('volume-2'), 'accepting');
  // Another volume mounted at the path (another identity) is never written to.
  await writeFile(join(second, 'storage-id'), randomUUID());
  await probeStorageBackends(writer, known, { create: true, changed });
  assert.equal(writer.fault('volume-2'), 'identity_mismatch');
  // A failure of the database says nothing about the storage: its state is kept.
  const broken = { recorded: async () => Promise.reject(new Error('database down')) };
  await probeStorageBackends(writer, broken, { create: true, changed });
  assert.equal(writer.fault('volume-2'), 'identity_mismatch');
  await writeFile(join(second, 'storage-id'), known.map.get('volume-2'));
  await probeStorageBackends(writer, known, { create: true, changed });
  assert.equal(writer.fault('volume-2'), null);
  assert.deepEqual(changes, [
    ['volume-2', 'identity_unknown'],
    ['volume-2', 'not_initialized'],
    ['volume-2', null],
    ['volume-2', null],
    ['volume-2', 'identity_mismatch'],
    ['volume-2', null],
  ]);
  // A volume that went away: the directory without its layout fails the recheck.
  const gone = localStorageBackends(data, 0, [
    { ...settings[0], directory: join(second, 'missing') },
  ]);
  await probeStorageBackends(gone, known, { create: true });
  assert.equal(gone.fault('volume-2'), 'probe_failed');
});

/** Two directories as on a host: the data directory and the mount point of volume-2. */
async function mounted(t) {
  const data = await directory(t, 'arkvory-mount-core-');
  const mountPoint = await directory(t, 'arkvory-mount-v2-');
  const settings = [
    { id: 'volume-2', directory: mountPoint, enabled: true, mode: 'full', acceptsWrites: true },
  ];
  const backends = localStorageBackends(data, 0, settings);
  // As at the start of the API: `default` is initialized and has its identity before the rest.
  await backends.core.lifecycle.initialize();
  await backends.core.lifecycle.identity();
  await volumeInit(mountPoint);
  const known = records();
  await probeStorageBackends(backends, known, { create: true });
  assert.equal(backends.state('volume-2'), 'accepting');
  return { data, mountPoint, settings, backends, known };
}
const tree = async (root) =>
  (await readdir(root, { recursive: true })).map((entry) => entry.split(sep).join('/')).sort();

test('a volume that goes away between rechecks is never written to, and nothing lands beneath its mount point', async (t) => {
  const { mountPoint, backends } = await mounted(t);
  const id = randomUUID();
  await backends.put(id, descriptor, once(), cancellation, 'volume-2');
  // The volume is unmounted: the mount point is an empty directory of the root file system.
  // The next recheck is up to 30 s away, yet the very next write and removal already refuse.
  const unmounted = `${mountPoint}-mounted`;
  await rename(mountPoint, unmounted);
  t.after(() => removeTestDirectory(unmounted));
  await mkdir(mountPoint);
  assert.equal(backends.state('volume-2'), 'accepting');
  const part = { index: 0, size: bytes.length, sha256: descriptor.sha256 };
  await assert.rejects(backends.putPart(randomUUID(), part, once(), cancellation, 'volume-2'), {
    code: 'unavailable',
  });
  await assert.rejects(backends.put(randomUUID(), descriptor, once(), cancellation, 'volume-2'), {
    code: 'unavailable',
  });
  await assert.rejects(backends.duplicate(id, randomUUID(), descriptor, cancellation, 'volume-2'), {
    code: 'unavailable',
  });
  // Cleanup waits instead of counting files of an absent volume as removed.
  await assert.rejects(backends.collect(id, true, cancellation, 'volume-2'), { code: 'busy' });
  assert.deepEqual(await tree(mountPoint), []);
  // Reads of the absent volume fail too, without falling back to another storage.
  await assert.rejects(backends.exists(id, bytes.length, 'volume-2'), { code: 'unavailable' });
  // Another volume at the same path (another identity) is refused the same way.
  await writeFile(join(mountPoint, 'storage-id'), randomUUID());
  await assert.rejects(backends.put(randomUUID(), descriptor, once(), cancellation, 'volume-2'), {
    code: 'unavailable',
  });
  assert.deepEqual(await tree(mountPoint), ['storage-id']);
  // Mounted again: the same volume is used again without waiting for a recheck.
  await rm(mountPoint, { recursive: true });
  await rename(unmounted, mountPoint);
  await backends.put(randomUUID(), descriptor, once(), cancellation, 'volume-2');
  await backends.collect(id, true, cancellation, 'volume-2');
});

test('a volume storage never creates its directory or layout outside initialize of a restore', async (t) => {
  const parent = await directory(t, 'arkvory-volume-layout-');
  const missing = join(parent, 'not-mounted');
  const store = new LocalBlobStore(missing, 0, undefined, { createRoot: false });
  await assert.rejects(store.initialize(), { code: 'ENOENT' });
  assert.deepEqual(await tree(parent), []);
  // A mount point without layout (the volume is not mounted): writes create nothing.
  await mkdir(missing);
  const part = { index: 0, size: bytes.length, sha256: descriptor.sha256 };
  await assert.rejects(store.putPart(randomUUID(), part, once(), cancellation), {
    code: 'unavailable',
  });
  await assert.rejects(store.put(randomUUID(), descriptor, once(), cancellation), {
    code: 'unavailable',
  });
  assert.deepEqual(await tree(parent), ['not-mounted']);
  await store.initialize();
  await store.putPart(randomUUID(), part, once(), cancellation);
  // A restore target creates its new, empty directories.
  const restored = new LocalBlobStore(join(parent, 'restored'), 0, 0o700, { createRoot: true });
  await restored.initialize();
  await restored.ready();
});

test('a recheck never creates an identity on record again, and two ids for one directory are refused', async (t) => {
  const { data, mountPoint, settings, backends, known } = await mounted(t);
  // The layout without its identity file: an emptied or foreign volume is not adopted.
  await rm(join(mountPoint, 'storage-id'));
  await probeStorageBackends(backends, known, { create: true });
  assert.equal(backends.fault('volume-2'), 'probe_failed');
  assert.deepEqual(await tree(mountPoint), ['blobs', 'parts', 'staging']);
  // A second id configured for the data directory itself (through a link, say) proves the
  // identity of `default` and is refused before anything is recorded for it.
  const aliased = localStorageBackends(data, 0, [
    ...settings,
    { ...settings[0], id: 'volume-3', directory: data },
  ]);
  const fresh = records();
  await probeStorageBackends(aliased, fresh, { create: true });
  assert.equal(aliased.fault('volume-3'), 'identity_mismatch');
  assert.equal(fresh.map.has('volume-3'), false);
});

test('in a cluster every volume must be on the replicated file system of the data directory', async (t) => {
  const data = await directory(t, 'arkvory-cluster-core-');
  const settings = (directory) => [
    { id: 'volume-2', directory, enabled: true, mode: 'full', acceptsWrites: true },
  ];
  await requireReplicatedVolumes(data, settings(join(data + '-beside')), async () => 1);
  // Another disk stays behind on a failed server; a missing directory is no proof either.
  for (const device of [
    async (path) => (path === data ? 1 : 2),
    async (path) => {
      if (path !== data) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return 1;
    },
  ])
    await assert.rejects(
      requireReplicatedVolumes(data, settings(join(data + '-other')), device),
      /not on the replicated volume \/modules\/local-storage\/config\/instances\/volume-2\/directory$/,
    );
  // The real file system: a directory beside the data directory in the same temporary folder.
  const beside = await directory(t, 'arkvory-cluster-v2-');
  await requireReplicatedVolumes(data, settings(beside));
});

test('the worker logs a volume that is not usable at start and every later change', async (t) => {
  const { watchWorkerStorage } = await import('../apps/worker/dist/storage-watch.js');
  const data = await directory(t, 'arkvory-worker-core-');
  const settings = [
    {
      id: 'volume-2',
      directory: join(data + '-absent'),
      enabled: true,
      mode: 'full',
      acceptsWrites: true,
    },
  ];
  const backends = localStorageBackends(data, 0, settings);
  backends.mark('volume-2', 'identity_unknown');
  const lines = [];
  const unwatch = watchWorkerStorage(backends, { pool: {} }, { write: (line) => lines.push(line) });
  unwatch();
  assert.deepEqual(lines, [
    {
      level: 'warning',
      component: 'storage',
      code: 'storage.backend_unavailable',
      backend: 'volume-2',
      reason: 'identity_unknown',
    },
  ]);
});

test('a part that is not there is unavailable, not a file system error', async (t) => {
  const store = new LocalBlobStore(await directory(t, 'arkvory-parts-missing-'), 0);
  await store.initialize();
  const part = { index: 0, size: bytes.length, sha256: descriptor.sha256 };
  const reading = store.readParts(randomUUID(), [part]);
  await assert.rejects(reading[Symbol.asyncIterator]().next(), { code: 'unavailable' });
});

test('a volume removed from the configuration is reported, never deferred silently', async (t) => {
  const data = await directory(t, 'arkvory-removed-core-');
  const second = await directory(t, 'arkvory-removed-v2-');
  await volumeInit(second);
  const settings = [
    { id: 'volume-2', directory: second, enabled: true, mode: 'full', acceptsWrites: true },
  ];
  const known = records();
  const before = localStorageBackends(data, 0, settings);
  await probeStorageBackends(before, known, { create: true });
  assert.equal(before.state('volume-2'), 'accepting');
  // The operator drops the instance from the modules file: the installation still has its data.
  const after = localStorageBackends(data, 0, []);
  const changes = [];
  const options = { create: true, changed: (id, fault) => changes.push([id, fault]) };
  await probeStorageBackends(after, known, options);
  await probeStorageBackends(after, known, options);
  assert.deepEqual(after.unconfigured(), ['volume-2']);
  assert.deepEqual(changes, [['volume-2', 'not_configured']], 'reported once');
  assert.equal(after.state('volume-2'), 'not_loaded');
  // Configured again: nothing is missing any more.
  const back = localStorageBackends(data, 0, settings);
  await probeStorageBackends(back, known, { create: true });
  assert.deepEqual(back.unconfigured(), []);
  // The placement answer lists it, so an operator sees what is missing.
  const control = new PlacementControl(
    {
      get: async () => ({
        repository: 'r',
        revision: 0,
        rules: [],
        updatedBy: null,
        updatedAt: null,
      }),
    },
    after,
  );
  const reader = {
    id: 'service:s',
    repositories: ['r'],
    permissions: [],
    managed: {
      accountId: 'a',
      keyId: 'k',
      bindings: [{ resource: { kind: 'repository', id: 'r' }, actions: ['storage.read'] }],
    },
  };
  const view = await control.get(reader, 'r');
  assert.deepEqual(view.backends, [
    { id: 'default', state: 'accepting' },
    { id: 'volume-2', state: 'not_loaded' },
  ]);
  // The metric and the log line of every process.
  assert.deepEqual(storageChangeRecord('volume-2', 'not_configured'), {
    level: 'warning',
    component: 'storage',
    code: 'storage.backend_unconfigured',
    backend: 'volume-2',
  });
  const { StorageMetrics } = await import('../apps/api/dist/storage-metrics.js');
  const lines = [];
  const metrics = new StorageMetrics(after);
  metrics.bind((line) => lines.push(line.code));
  assert.deepEqual(lines, ['storage.backend_unconfigured']);
});
