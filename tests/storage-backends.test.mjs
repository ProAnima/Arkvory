import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LocalBlobStore,
  StorageBackends,
  localStorageBackends,
  localStorageSettings,
  parseLocalStorageConfig,
  probeStorageBackends,
  builtinModules,
} from '@proanima/arkvory-infrastructure';
import { ModuleConfigError } from '@proanima/arkvory-extension-api';
import { removeTestDirectory } from './helpers.mjs';
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
    const make = () => {
      const store = new Store(second, 0);
      const backends = new StorageBackends([
        instance('default', new LocalBlobStore(core, 0)),
        instance('volume-2', store),
      ]);
      backends.mark('volume-2', null);
      return { blobs: backends, lifecycle: store, backendId: 'volume-2' };
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
  backends.mark('volume-2', null);
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
  const backends = new StorageBackends([
    instance('default', new MemoryBlobStore()),
    instance('archive', frozen, { mode: 'read-only' }),
    instance('draining', new MemoryBlobStore(), { acceptsWrites: false }),
    instance('off', new MemoryBlobStore(), { enabled: false }),
  ]);
  for (const id of ['archive', 'draining']) backends.mark(id, null);
  backends.mark('off', null);
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
  };
}

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
  // The writer initializes it and records its identity.
  const writer = localStorageBackends(data, 0, settings);
  await probeStorageBackends(writer, known, { create: true, changed });
  assert.equal(writer.state('volume-2'), 'accepting');
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
