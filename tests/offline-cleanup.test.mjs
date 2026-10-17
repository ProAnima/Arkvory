import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GarbageCollector } from '@proanima/arkvory-application';
import { ArkvoryError } from '@proanima/arkvory-domain';
import { LocalBlobStore } from '@proanima/arkvory-infrastructure';
import { removeTestDirectory } from './helpers.mjs';

const row = {
  id: '00000000-0000-4000-8000-000000000001',
  repository: 'releases',
  status: 'cancelled',
  cancelledAt: '2026-01-01T00:00:00.000Z',
  expiresAt: '2026-01-01T00:00:00.000Z',
};

for (const interruptedAt of ['page', 'lock', 'delete']) {
  test(`offline cleanup stops after ownership loss during ${interruptedAt}`, async () => {
    let active = true;
    let deleted = 0;
    let reclaimed = 0;
    const lost = new Error('Maintenance protection lost');
    const cancellation = {
      throwIfAborted() {
        if (!active) throw lost;
      },
    };
    const gc = new GarbageCollector(
      {
        async page(after) {
          if (interruptedAt === 'page') active = false;
          return after ? [] : [row];
        },
        async exclusive(_id, removeContent, action) {
          assert.equal(removeContent, true);
          if (interruptedAt === 'lock') active = false;
          return action({ throwIfAborted() {} });
        },
        async reclaimed() {
          reclaimed++;
        },
        async expire() {
          assert.fail('Cancelled records must not expire');
        },
      },
      {
        async collect(_id, _removeContent, protection) {
          protection.throwIfAborted();
          deleted++;
          if (interruptedAt === 'delete') active = false;
        },
      },
      cancellation,
    );
    await assert.rejects(gc.run('2026-01-03T00:00:00.000Z'), (error) => error === lost);
    assert.equal(deleted, interruptedAt === 'delete' ? 1 : 0);
    assert.equal(reclaimed, 0, 'Uncertain deletion must retain quota for safe reconciliation');
  });
}

test('local reclamation stops between filesystem phases after protection loss', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'arkvory-cleanup-ownership-'));
  t.after(() => removeTestDirectory(root));
  const blobs = new LocalBlobStore(root);
  await blobs.initialize();
  const staging = join(root, 'staging', row.id);
  const parts = join(root, 'parts', row.id);
  await mkdir(staging);
  await mkdir(parts);
  await writeFile(join(staging, 'temporary'), 'staging');
  await writeFile(join(parts, 'part'), 'parts');
  await writeFile(join(blobs.root, 'blobs', row.id), 'content');
  let checked = 0;
  const lost = new Error('Ownership lost after staging removal');
  await assert.rejects(
    blobs.collect(row.id, true, {
      throwIfAborted() {
        if (++checked === 2) throw lost;
      },
    }),
    (error) => error === lost,
  );
  await assert.rejects(access(staging), { code: 'ENOENT' });
  assert.equal(await readFile(join(parts, 'part'), 'utf8'), 'parts');
  assert.equal(await readFile(join(blobs.root, 'blobs', row.id), 'utf8'), 'content');
});

test('offline cleanup defers an object refused as busy, such as backup-pinned content', async () => {
  const other = { ...row, id: '00000000-0000-4000-8000-000000000002' };
  let deleted = 0;
  let reclaimed = 0;
  const gc = new GarbageCollector(
    {
      async page(after) {
        return after ? [] : [row, other];
      },
      async exclusive(id, _removeContent, action) {
        if (id === row.id) throw new ArkvoryError('busy', 'Content is protected by a backup');
        return action({ throwIfAborted() {} });
      },
      async reclaimed() {
        reclaimed++;
      },
      async expire() {
        assert.fail('Cancelled records must not expire');
      },
    },
    {
      async collect() {
        deleted++;
      },
    },
    { throwIfAborted() {} },
  );
  assert.deepEqual(await gc.run('2026-01-03T00:00:00.000Z'), {
    visited: 2,
    collected: 1,
    deferred: 1,
  });
  assert.equal(deleted, 1);
  assert.equal(reclaimed, 1);
});

test('offline cleanup collects each upload from the storage that holds it', async () => {
  const placed = { ...row, id: '00000000-0000-4000-8000-000000000003', storageBackend: 'volume-2' };
  const kept = { ...row, id: '00000000-0000-4000-8000-000000000004', status: 'available' };
  const collected = [];
  const gc = new GarbageCollector(
    {
      async page(after) {
        return after ? [] : [placed, kept];
      },
      async exclusive(_id, _removeContent, action) {
        return action({ throwIfAborted() {} });
      },
      async reclaimed() {},
      async expire() {
        assert.fail('No record here is pending');
      },
    },
    {
      async collect(id, removeContent, _cancellation, backendId) {
        collected.push({ id, removeContent, backendId });
      },
    },
    { throwIfAborted() {} },
  );
  await gc.run('2026-01-03T00:00:00.000Z');
  // Absent is the default storage, as on a record written before storages were named.
  assert.deepEqual(collected, [
    { id: placed.id, removeContent: true, backendId: 'volume-2' },
    { id: kept.id, removeContent: false, backendId: 'default' },
  ]);
});

test('offline cleanup collects parts left behind a switch in their own storage first', async () => {
  // Finished in `default` after volume-2 stopped taking data (ADR 0083, N11).
  const switched = {
    ...row,
    id: '00000000-0000-4000-8000-000000000005',
    storageBackend: 'default',
    partsBackend: 'volume-2',
  };
  const collected = [];
  let busy = true;
  const gc = new GarbageCollector(
    {
      async page(after) {
        return after ? [] : [switched];
      },
      async exclusive(_id, _removeContent, action) {
        return action({ throwIfAborted() {} });
      },
      async reclaimed() {},
      async expire() {
        assert.fail('No record here is pending');
      },
    },
    {
      async collect(id, removeContent, _cancellation, backendId) {
        // A storage that is not available makes cleanup wait (ADR 0078, L5).
        if (busy && backendId === 'volume-2') {
          busy = false;
          throw new ArkvoryError('busy', 'Storage backend is not available');
        }
        collected.push({ id, removeContent, backendId });
      },
    },
    { throwIfAborted() {} },
  );
  assert.equal((await gc.run('2026-01-03T00:00:00.000Z')).deferred, 1);
  assert.deepEqual(collected, []);
  assert.equal((await gc.run('2026-01-03T00:00:00.000Z')).collected, 1);
  assert.deepEqual(collected, [
    { id: switched.id, removeContent: false, backendId: 'volume-2' },
    { id: switched.id, removeContent: true, backendId: 'default' },
  ]);
});
