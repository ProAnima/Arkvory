import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GarbageCollector } from '@proanima/depot-application';
import { LocalBlobStore } from '@proanima/depot-infrastructure';
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
  const root = await mkdtemp(join(tmpdir(), 'depot-cleanup-ownership-'));
  t.after(() => removeTestDirectory(root));
  const blobs = new LocalBlobStore(root);
  await blobs.initialize();
  const staging = join(root, 'staging', row.id);
  const parts = join(root, 'parts', row.id);
  await mkdir(staging);
  await mkdir(parts);
  await writeFile(join(staging, 'temporary'), 'staging');
  await writeFile(join(parts, 'part'), 'parts');
  await writeFile(blobs.contentPath(row.id), 'content');
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
  assert.equal(await readFile(blobs.contentPath(row.id), 'utf8'), 'content');
});
