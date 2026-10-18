import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StorageService } from '@proanima/arkvory-application';
import { ModuleServiceError } from '@proanima/arkvory-extension-api';
import { LocalBlobStore, StorageBackends } from '@proanima/arkvory-infrastructure';
import { removeTestDirectory } from '../helpers.mjs';
import { DirectoryBackend } from '../contracts/directory-backend.mjs';
import { setup } from './fixture.mjs';

// Completion of a multipart upload from parts its storage accepted (ADR 0083, N1), on
// PostgreSQL: the core reads and checks the composed object, the storage commits, then the
// catalog publishes; a wrong byte, a crash after commit and a read-only storage.
const PART = 8 * 1024 * 1024;
const principal = {
  credential: 'file-key',
  id: 'test-writer',
  repositories: ['releases'],
  permissions: ['read', 'write'],
};
const cancellation = { throwIfAborted() {} };
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function* once(bytes) {
  yield bytes;
}

async function scratch(t, prefix) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => removeTestDirectory(directory));
  return directory;
}

/** The core's storage and `volume-2`, a test storage that composes from its own parts. */
async function storages(t, staged = (store) => store.staged()) {
  const core = new LocalBlobStore(await scratch(t, 'arkvory-staged-core-'), 0);
  const root = await scratch(t, 'arkvory-staged-v2-');
  const second = new DirectoryBackend(root);
  await core.initialize();
  await second.initialize();
  let writes = 0;
  // Every method of the test storage, with whole-object writes counted.
  const counted = Object.fromEntries(
    ['initialize', 'ready', 'identity', 'checkSpace', 'requireEmpty', 'exists', 'read', 'verify']
      .concat(['duplicate', 'putPart', 'readParts', 'collect'])
      .map((name) => [name, (...args) => second[name](...args)]),
  );
  counted.put = (...args) => {
    writes++;
    return second.put(...args);
  };
  const instance = (id, store, extra = {}) => ({
    id,
    blobs: store,
    lifecycle: store,
    mode: 'full',
    acceptsWrites: true,
    enabled: true,
    ...extra,
  });
  const blobs = new StorageBackends([
    instance('default', core),
    instance('volume-2', counted, { staged: staged(second) }),
  ]);
  blobs.mark('volume-2', null, await second.identity());
  return { blobs, core, second, root, writes: () => writes };
}

function serviceOf(catalog, blobs, ids = () => randomUUID()) {
  return new StorageService(
    catalog,
    blobs,
    { next: ids, now: () => new Date().toISOString() },
    {
      placement: { place: async () => ({ backendId: 'volume-2' }), state: (id) => blobs.state(id) },
      staged: blobs,
    },
  );
}

/** A two-part upload in `volume-2` with both parts accepted. */
async function uploaded(service, blobs) {
  const bytes = randomBytes(PART + 1000);
  const descriptor = {
    name: 'big.bin',
    size: String(bytes.length),
    sha256: sha(bytes),
    labels: [],
    metadata: {},
  };
  const upload = await service.create(principal, 'releases', randomUUID(), descriptor);
  assert.equal(upload.storageBackend, 'volume-2');
  const halves = [bytes.subarray(0, PART), bytes.subarray(PART)];
  for (const [index, half] of halves.entries())
    await service.uploadPart(
      principal,
      'releases',
      upload.id,
      index,
      sha(half),
      once(half),
      cancellation,
    );
  return {
    id: upload.id,
    bytes,
    parts: halves.map((half, index) => ({ index, size: half.length, sha256: sha(half) })),
  };
}

async function gather(source) {
  const chunks = [];
  for await (const chunk of source) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

test('a storage composes the object from its parts; the core checks it and publishes once', async (t) => {
  const f = await setup(t);
  const { blobs, writes } = await storages(t);
  const service = serviceOf(f.catalog, blobs);
  const { id, bytes } = await uploaded(service, blobs);
  const done = await service.complete(principal, 'releases', id, cancellation);
  assert.equal(done.status, 'available');
  assert.equal(done.storageBackend, 'volume-2');
  assert.equal(writes(), 0, 'the object never passed through the core as a second write');
  assert.deepEqual(await gather(blobs.read(id, bytes.length, undefined, 'volume-2')), bytes);
  // The parts are collected by the core's cleanup; the committed object stays.
  await blobs.collect(id, false, cancellation, 'volume-2');
  await blobs.verify(id, done.descriptor, cancellation, 'volume-2');
});

test('a byte changed in a stored part is refused before anything is published', async (t) => {
  const f = await setup(t);
  const { blobs, root } = await storages(t);
  const service = serviceOf(f.catalog, blobs);
  const { id, bytes, parts } = await uploaded(service, blobs);
  const path = join(root, 'parts', id, `1-${parts[1].sha256}`);
  const handle = await open(path, 'r+');
  await handle.write(Buffer.from([bytes[PART] ^ 0xff]), 0, 1, 0);
  await handle.close();
  await assert.rejects(service.complete(principal, 'releases', id, cancellation), {
    code: 'integrity_mismatch',
  });
  assert.equal((await service.status(principal, 'releases', id)).status, 'pending');
  await assert.rejects(blobs.exists(id, bytes.length, 'volume-2'), { code: 'unavailable' });
  // The part is sent again and the completion goes through.
  await blobs.putPart(id, parts[1], once(bytes.subarray(PART)), cancellation, 'volume-2');
  assert.equal(
    (await service.complete(principal, 'releases', id, cancellation)).status,
    'available',
  );
});

test('a crash between commit and publication is completed by a retry, published once', async (t) => {
  const f = await setup(t);
  let crash = true;
  const { blobs } = await storages(t, (store) => ({
    async compose(id, parts, signal) {
      const object = await store.staged().compose(id, parts, signal);
      return {
        ...object,
        size: object.size,
        read: (range) => object.read(range),
        async commit(expected, commitSignal) {
          await object.commit(expected, commitSignal);
          if (crash) throw new Error('process stopped after the commit');
        },
      };
    },
  }));
  const service = serviceOf(f.catalog, blobs);
  const { id, bytes } = await uploaded(service, blobs);
  await assert.rejects(service.complete(principal, 'releases', id, cancellation), {
    code: 'unavailable',
  });
  assert.equal((await service.status(principal, 'releases', id)).status, 'pending');
  crash = false;
  const done = await service.complete(principal, 'releases', id, cancellation);
  assert.equal(done.status, 'available');
  assert.deepEqual(await gather(blobs.read(id, bytes.length, undefined, 'volume-2')), bytes);
  const events = await f.catalog.pool.query(
    `SELECT count(*)::int AS n FROM arkvory_uploads WHERE id=$1 AND status='available'`,
    [id],
  );
  assert.equal(events.rows[0].n, 1);
});

test('a storage that refuses composing read-only gets the object written to the core', async (t) => {
  const f = await setup(t);
  const { blobs } = await storages(t, () => ({
    compose: () => Promise.reject(new ModuleServiceError('read_only')),
  }));
  const service = serviceOf(f.catalog, blobs);
  const { id, bytes } = await uploaded(service, blobs);
  const done = await service.complete(principal, 'releases', id, cancellation);
  assert.equal(done.status, 'available');
  assert.equal(done.storageBackend, 'default');
  assert.equal(done.partsBackend, 'volume-2');
  assert.deepEqual(await gather(blobs.read(id, bytes.length, undefined, 'default')), bytes);
});
