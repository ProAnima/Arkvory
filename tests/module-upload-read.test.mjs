import test from 'node:test';
import assert from 'node:assert/strict';
import { ScopedUploads } from '@proanima/arkvory-application';
import { ArkvoryError } from '@proanima/arkvory-domain';
import { AccessScopes } from '@proanima/arkvory-infrastructure';
import { moduleUploads } from '../packages/infrastructure/dist/module-upload-read.js';
import { uploadReadContract, gather } from '../packages/extension-testkit/dist/index.js';

const id = '00000000-0000-4000-8000-000000000001';
const ref = { repository: 'releases', id };
const principal = {
  id: 'owner',
  credential: 'file-key',
  repositories: ['releases'],
  permissions: ['write'],
};
function fixture() {
  const scopes = new AccessScopes();
  const root = scopes.of([principal]);
  const owner = scopes.intersect(root, scopes.of([principal]));
  const stranger = scopes.of([{ ...principal, id: 'stranger' }]);
  const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const upload = {
    id,
    repository: ref.repository,
    owner: principal.id,
    status: 'pending',
    expiresAt: '2030-01-01',
    descriptor: { size: 12, sha256: 'a'.repeat(64) },
    partBytes: 4,
    storageBackend: 'target',
    partsBackend: 'parts',
  };
  let pins = 0,
    lost = false;
  const touched = [];
  const catalog = {
    async get(repository, wanted) {
      if (repository !== ref.repository || wanted !== id)
        throw new ArkvoryError('not_found', 'Absent');
      return upload;
    },
    async parts() {
      return [0, 1].map((index) => ({ index, size: 4, sha256: 'a'.repeat(64) }));
    },
  };
  const pinning = {
    async acquire() {
      pins++;
      return {
        check() {
          if (lost) throw new ArkvoryError('unavailable', 'Lost pin');
        },
        async release() {
          pins--;
        },
      };
    },
  };
  const blobs = {
    async *readParts(wanted, parts, backend) {
      touched.push({ wanted, parts, backend });
      for (const part of parts) yield bytes.slice(part.index * 4, part.index * 4 + 4);
    },
  };
  const service = new ScopedUploads(catalog, blobs, pinning, () => '2026-10-19');
  return {
    reader: moduleUploads(service, scopes),
    owner,
    stranger,
    ref,
    bytes,
    scopes,
    upload,
    touched,
    revoke: () => scopes.revoke(root),
    pins: () => pins,
    lose: () => {
      lost = true;
    },
  };
}
uploadReadContract('core upload-read', async () => fixture());

test('parts ranges cross boundaries, refuse holes and preserve placement without exposing unauthorized data', async () => {
  const f = fixture();
  const signal = new AbortController().signal;
  const read = (scope, range, reference = ref) =>
    gather(f.reader.read(scope, reference, range, signal));
  assert.deepEqual(await read(f.owner, { start: 2, end: 5 }), f.bytes.slice(2, 6));
  assert.equal(f.touched[0].backend, 'parts');
  for (const range of [
    { start: 6, end: 9 },
    { start: 8, end: 11 },
  ])
    await assert.rejects(read(f.owner, range), { code: 'conflict' });
  await assert.rejects(read(f.owner, { start: 0, end: 12 }), { code: 'invalid_input' });
  assert.equal(f.pins(), 0);
  for (const scope of [f.stranger, f.scopes.of([{ ...principal, permissions: ['read'] }])]) {
    assert.equal(await f.reader.upload(scope, ref.repository, id), null);
    assert.equal((await read(scope, { start: 0, end: 1 })).length, 0);
  }
  for (const range of [
    null,
    { start: 0.5, end: 2 },
    { start: 0, end: Number.MAX_SAFE_INTEGER + 1 },
  ])
    await assert.rejects(read(f.stranger, range), { code: 'invalid_input' });
  for (const state of ['available', 'cancelled']) {
    f.upload.status = state;
    assert.equal(await f.reader.upload(f.owner, ref.repository, id), null);
  }
  f.upload.status = 'pending';
  f.upload.expiresAt = '2020-01-01';
  assert.equal(await f.reader.upload(f.owner, ref.repository, id), null);
  assert.equal(f.touched.length, 1, 'refusals never touched storage');
});

test('lost ownership and early iterator return release the upload lock', async () => {
  const f = fixture();
  const iterator = f.reader
    .read(f.owner, ref, { start: 0, end: 7 }, new AbortController().signal)
    [Symbol.asyncIterator]();
  await iterator.next();
  f.lose();
  await assert.rejects(iterator.next(), { code: 'unavailable' });
  assert.equal(f.pins(), 0);
  const g = fixture();
  for await (const chunk of g.reader.read(
    g.owner,
    ref,
    { start: 0, end: 7 },
    new AbortController().signal,
  )) {
    assert.ok(chunk.length);
    break;
  }
  assert.equal(g.pins(), 0);
});
