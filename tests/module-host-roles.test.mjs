import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ModuleStorages,
  probeStorageBackends,
  ModuleRemoval,
  StorageBackends,
  LocalBlobStore,
  ModuleCompute,
  ModuleChangeFeed,
  ModuleHostServices,
} from '@proanima/arkvory-infrastructure';
import { hostServiceAvailable } from '@proanima/arkvory-extension-api';
import {
  storageRegistrationContract,
  computeContract,
  changeFeedContract,
} from '../packages/extension-testkit/dist/index.js';
import { removeTestDirectory } from './helpers.mjs';

async function directory(t) {
  const root = await mkdtemp(join(tmpdir(), 'arkvory-host-roles-'));
  t.after(() => removeTestDirectory(root));
  return root;
}
async function stores(t) {
  const root = await directory(t);
  const core = new LocalBlobStore(join(root, 'core'), 0);
  const extra = new LocalBlobStore(join(root, 'extra'), 0);
  await core.initialize();
  await extra.initialize();
  const backends = new StorageBackends([
    {
      id: 'default',
      blobs: core,
      lifecycle: core,
      mode: 'full',
      acceptsWrites: true,
      enabled: true,
    },
  ]);
  const host = new ModuleStorages(backends, false);
  let accepting = true;
  const instance = { blobs: extra, lifecycle: extra, mode: 'full', acceptsWrites: () => accepting };
  return {
    host,
    backends,
    instance,
    extra,
    change: (value) => {
      accepting = value;
    },
  };
}
storageRegistrationContract('signed storage registry', async (t) => {
  const h = await stores(t);
  return {
    registry: h.host.storage('signed-store'),
    instance: h.instance,
    seal: () => h.host.seal('signed-store'),
  };
});
computeContract('signed compute', async (t) => {
  const root = await directory(t);
  await mkdir(join(root, 'files'));
  await writeFile(join(root, 'files', 'echo.mjs'), 'export default input => input;');
  const pool = new ModuleCompute(root, [{ name: 'echo', entry: 'files/echo.mjs' }]);
  t.after(() => pool.close());
  return pool;
});
changeFeedContract('worker change feed', async (t) => {
  const host = new ModuleChangeFeed({}, {}, () => true);
  t.after(() => host.close());
  return host.for('signed-index');
});
test('module storage becomes eligible only after activation and can withdraw new writes live', async (t) => {
  const h = await stores(t);
  h.host.storage('signed-store').add('data', h.instance);
  h.host.seal('signed-store');
  assert.equal(h.backends.state('signed-store.data'), 'disabled');
  h.host.active('signed-store', true);
  h.backends.mark('signed-store.data', null, await h.extra.identity());
  assert.equal(h.backends.state('signed-store.data'), 'accepting');
  h.change(false);
  assert.equal(h.backends.state('signed-store.data'), 'not_accepting');
  h.host.active('signed-store', false);
  assert.equal(h.backends.state('signed-store.data'), 'disabled');
});
test('cleanup authority expires after collect and never leaks to an independent call', async () => {
  const removal = new ModuleRemoval();
  assert.throws(() => removal.require(), { code: 'busy' });
  let later;
  await removal.collect(
    () => undefined,
    async () => {
      removal.require();
      later = new Promise((resolve) =>
        setTimeout(() => {
          assert.throws(() => removal.require(), { code: 'busy' });
          resolve();
        }, 10),
      );
    },
  );
  await later;
});
test('services are filtered per role and source for a multi-role module', async () => {
  assert.equal(hostServiceAvailable('routes', 'worker', 'signed'), false);
  assert.equal(hostServiceAvailable('change-feed', 'worker', 'signed'), true);
  assert.equal(hostServiceAvailable('staged-completion', 'reader', 'signed'), false);
  assert.equal(hostServiceAvailable('blob-store', 'api', 'operator'), false);
  const host = new ModuleHostServices({
    dataDirectory: tmpdir(),
    reserve: { bytes: 0, inodes: 0 },
    readOnly: true,
    role: 'backup',
    catalog: () => {
      throw Error('must not build');
    },
  });
  assert.deepEqual(
    host.for(
      {
        source: 'signed',
        manifest: {
          id: 'signed-index',
          uses: ['catalog-read', 'content-read', 'routes'],
          roles: ['api', 'worker', 'backup'],
        },
      },
      null,
    ),
    {},
  );
  await host.close();
});

test('first probe checks module identity before initialize and later probes call ready', async (t) => {
  const h = await stores(t);
  const calls = [];
  let initialized = false;
  const identity = await h.extra.identity();
  const lifecycle = {
    identity: async (readOnly) => {
      calls.push(['identity', readOnly]);
      return identity;
    },
    initialize: async () => {
      calls.push('initialize');
      initialized = true;
    },
    ready: async () => {
      calls.push('ready');
      assert.equal(initialized, true);
    },
    checkSpace: async () => undefined,
    requireEmpty: async () => undefined,
  };
  h.host.storage('signed-store').add('new', { ...h.instance, lifecycle });
  h.host.seal('signed-store');
  h.host.active('signed-store', true);
  let recorded = null;
  const records = {
    recorded: async () => recorded,
    record: async (_id, value) => {
      recorded = value;
      return value;
    },
    known: async () => [],
  };
  await probeStorageBackends(h.backends, records, { create: true });
  assert.equal(h.backends.state('signed-store.new'), 'accepting');
  assert.deepEqual(calls, [['identity', true], 'initialize']);
  calls.length = 0;
  await probeStorageBackends(h.backends, records, { create: false });
  assert.deepEqual(calls, [['identity', true], 'ready']);
});

test('closing an old feed subscription twice does not unregister its replacement', async () => {
  const host = new ModuleChangeFeed({}, {}, () => true);
  const feed = host.for('signed-index');
  const spec = {
    consumer: 'build',
    types: ['artifact.published'],
    batch: 1,
    handle: async () => undefined,
    resync: async () => undefined,
  };
  const first = feed.subscribe(spec);
  await first.close();
  const second = feed.subscribe(spec);
  try {
    await first.close();
    assert.throws(() => feed.subscribe(spec), { code: 'busy' });
  } finally {
    await second.close();
    host.close();
  }
});

test('module stream failures become core errors without leaking module messages', async (t) => {
  const h = await stores(t);
  const blobs = Object.create(h.instance.blobs);
  blobs.read = async function* () {
    yield new Uint8Array([1]);
    throw Error('private backend detail');
  };
  h.host.storage('signed-store').add('data', { ...h.instance, blobs });
  h.host.seal('signed-store');
  h.host.active('signed-store', true);
  h.backends.mark('signed-store.data', null, await h.extra.identity());
  await assert.rejects(
    async () => {
      for await (const chunk of h.backends.read('ignored', 2, undefined, 'signed-store.data'))
        assert.deepEqual(chunk, new Uint8Array([1]));
    },
    (error) => error.code === 'unavailable' && !error.message.includes('private'),
  );
});

for (const reason of ['epoch_changed', 'cursor_expired']) {
  test(
    `feed ${reason} resynchronizes before saving the current head`,
    { timeout: 5000 },
    async () => {
      let active = true;
      let saved;
      const completed = new Promise((resolve) => {
        saved = resolve;
      });
      const before = {
        epoch: reason === 'epoch_changed' ? 'old' : 'current',
        position: 1n,
        revision: 2n,
      };
      const calls = [];
      const host = new ModuleChangeFeed(
        {
          readInternal: async () => ({
            epoch: 'current',
            oldest: 5n,
            head: 12n,
            after: 1n,
            scannedThrough: 7n,
            items: [],
          }),
        },
        {
          read: async () => before,
          save: async (module, consumer, cursor, epoch, position) => {
            calls.push(['save', module, consumer, cursor, epoch, position]);
            active = false;
            saved();
            return true;
          },
        },
        () => active,
      );
      const subscription = host.for('signed-index').subscribe({
        consumer: 'build',
        types: ['artifact.*'],
        batch: 1,
        handle: async () => assert.fail('stale page must not be delivered'),
        resync: async (actual) => {
          calls.push(['resync', actual]);
        },
      });
      host.activate('signed-index');
      try {
        await completed;
        assert.deepEqual(calls, [
          ['resync', reason],
          ['save', 'signed-index', 'build', before, 'current', 12n],
        ]);
      } finally {
        await subscription.close();
        host.close();
      }
    },
  );
}
