import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { ArkvoryError } from '@proanima/arkvory-domain';
import { GarbageCollector } from '@proanima/arkvory-application';
import {
  FileVault,
  LocalBlobStore,
  PostgresCatalog,
  PostgresCleanup,
  admitUnlink,
  finishUnlink,
} from '@proanima/arkvory-infrastructure';
import { setup } from './fixture.mjs';
import {
  capture,
  captureJob,
  enableCleanup,
  gate,
  newVault,
  override,
  protection,
  publish,
  retire,
  sweep,
  until,
  upload,
} from './backup-fixture.mjs';

const never = { throwIfAborted() {} };

async function onDisk(f, item) {
  try {
    await new LocalBlobStore(f.directory).exists(item.id, item.bytes.length);
    return true;
  } catch {
    return false;
  }
}

/** Ids of rows published at T according to the exported uploads table of a point. */
async function exportedPublished(vaultPath, pointId) {
  const vault = await FileVault.open(vaultPath);
  const manifest = await vault.point(pointId);
  const table = manifest.tables.find((entry) => entry.name === 'arkvory_uploads');
  const ids = [];
  for await (const line of vault.lines(pointId, 'tables/arkvory_uploads.ndjson', table, never)) {
    const row = JSON.parse(line);
    if (row.status !== 'available') continue;
    const entry = { id: row.id, size: Number(row.size), sha256: row.descriptor.sha256 };
    assert.equal(await vault.blobDigest(entry, never), entry.sha256, `content of ${row.id}`);
    ids.push(row.id);
  }
  return ids.sort();
}

test('capture keeps every blob of T while publications, deletions and online cleanup continue', async (t) => {
  const f = await setup(t);
  await enableCleanup(f);
  const before = [];
  for (let index = 0; index < 6; index++) before.push(await publish(f));
  const { path: vault } = await newVault(t);
  const copying = gate();
  let first = true;
  const running = capture(f, vault, 'race', (deps) => ({
    ...deps,
    vault: override(deps.vault, {
      async putBlob(entry, source, cancellation) {
        if (first) {
          first = false;
          await copying.wait();
        }
        return deps.vault.putBlob(entry, source, cancellation);
      },
    }),
  }));
  await copying.entered;
  // T is closed, the barrier reopened: the instance keeps publishing and deleting.
  assert.deepEqual(await protection(f), { barrier: 'open', pins: before.length });
  const late = await publish(f);
  await retire(
    f,
    before.map((item) => item.id),
  );
  const pass = await sweep(f);
  assert.equal(pass.last_deferred, before.length);
  for (const item of before) {
    assert.equal(await onDisk(f, item), true, 'a pinned blob was unlinked');
    assert.equal((await upload(f, item.id)).reclaimed, false);
  }
  copying.release();
  const result = await running;
  assert.equal(result.outcome, 'created');
  assert.equal(result.blobs, before.length);
  assert.deepEqual(
    await exportedPublished(vault, result.pointId),
    before.map((item) => item.id).sort(),
  );
  assert.ok(!(await exportedPublished(vault, result.pointId)).includes(late.id));
  assert.deepEqual(await protection(f), { barrier: 'open', pins: 0 });
  await sweep(f);
  for (const item of before) {
    assert.equal(await onDisk(f, item), false);
    assert.equal((await upload(f, item.id)).reclaimed, true);
  }
});

test('the barrier waits for an admitted unlink and then refuses admissions until pins are durable', async (t) => {
  const f = await setup(t);
  await enableCleanup(f);
  const victim = await publish(f);
  const orphan = await publish(f);
  const kept = await publish(f);
  await retire(f, [victim.id]);
  const { path: vault } = await newVault(t);
  const unlinking = gate();
  const blobs = new LocalBlobStore(f.directory);
  const sweeping = sweep(f, {
    async collect(id, removeContent, cancellation) {
      if (removeContent) await unlinking.wait();
      return blobs.collect(id, removeContent, cancellation);
    },
  });
  await unlinking.entered;
  const pinning = gate();
  const running = capture(f, vault, 'barrier', (deps) => ({
    ...deps,
    pins: override(deps.pins, {
      async pin(lease, ids) {
        await pinning.wait();
        return deps.pins.pin(lease, ids);
      },
    }),
  }));
  const waiting = `SELECT 1 FROM pg_locks WHERE locktype='advisory' AND classid=18471
    AND objid=18 AND objsubid=2 AND NOT granted`;
  await until(async () => (await f.catalog.pool.query(waiting)).rowCount === 1, 'barrier wait');
  assert.equal((await protection(f)).barrier, 'open');
  unlinking.release();
  await sweeping;
  assert.equal((await upload(f, victim.id)).reclaimed, true);
  await pinning.entered;
  // Closed durably before T: nothing is admitted, pinned or not, until the pins commit.
  assert.deepEqual(await protection(f), { barrier: 'closed', pins: 0 });
  await retire(f, [orphan.id, kept.id]);
  const client = await f.catalog.pool.connect();
  try {
    assert.equal(await admitUnlink(client, orphan.id), false);
  } finally {
    client.release();
  }
  assert.equal((await sweep(f)).last_deferred, 2);
  pinning.release();
  const result = await running;
  assert.equal(result.blobs, 2, 'orphan and kept were published at T');
  await sweep(f);
  for (const item of [orphan, kept]) assert.equal((await upload(f, item.id)).reclaimed, true);
  const after = await f.catalog.pool.connect();
  try {
    const other = await publish(f);
    await retire(f, [other.id]);
    assert.equal(await admitUnlink(after, other.id), true);
    await finishUnlink(after);
  } finally {
    after.release();
  }
});

test('a capture fails with barrier_timeout while an admitted unlink does not finish', async (t) => {
  const f = await setup(t);
  await enableCleanup(f);
  const victim = await publish(f);
  await retire(f, [victim.id]);
  const { path: vault } = await newVault(t);
  const unlinking = gate();
  const blobs = new LocalBlobStore(f.directory);
  const sweeping = sweep(f, {
    async collect(id, removeContent, cancellation) {
      if (removeContent) await unlinking.wait();
      return blobs.collect(id, removeContent, cancellation);
    },
  });
  await unlinking.entered;
  try {
    await assert.rejects(
      capture(f, vault, 'timeout', undefined, { ARKVORY_BACKUP_BARRIER_SECONDS: '1' }),
      { code: 'barrier_timeout' },
    );
  } finally {
    unlinking.release();
    await sweeping;
  }
  const job = await captureJob(f, 'timeout');
  assert.equal(job.state, 'failed');
  assert.equal(job.error_code, 'barrier_timeout');
  assert.deepEqual(await protection(f), { barrier: 'open', pins: 0 });
});

const injected = () => new ArkvoryError('unavailable', 'Injected fault');
const boundaries = [
  {
    name: 'after the pins',
    state: 'failed',
    wrap: (deps) => ({
      ...deps,
      barrier: override(deps.barrier, {
        reopen: async () => {
          throw injected();
        },
      }),
    }),
  },
  {
    name: 'after the table export',
    state: 'failed',
    wrap: (deps) => ({
      ...deps,
      jobs: override(deps.jobs, {
        async advance(lease, phase) {
          if (phase === 'blobs') throw injected();
          return deps.jobs.advance(lease, phase);
        },
      }),
    }),
  },
  {
    name: 'during the blob copy',
    state: 'failed',
    wrap: (deps) => ({
      ...deps,
      content: {
        async *read(entry) {
          for await (const chunk of deps.content.read(entry)) {
            yield chunk.subarray(0, 1);
            throw injected();
          }
        },
      },
    }),
  },
  {
    name: 'before COMMITTED',
    state: 'committing',
    wrap: (deps) => ({
      ...deps,
      vault: override(deps.vault, {
        async stage(pointId, attempt) {
          const staged = await deps.vault.stage(pointId, attempt);
          return override(staged, {
            commit: async () => {
              throw injected();
            },
          });
        },
      }),
    }),
  },
  {
    name: 'after COMMITTED before the job receipt',
    state: 'committing',
    adopted: true,
    wrap: (deps) => ({
      ...deps,
      jobs: override(deps.jobs, {
        complete: async () => {
          throw injected();
        },
      }),
    }),
  },
];

async function committedPoints(vaultPath) {
  return (await FileVault.open(vaultPath)).pointIds();
}

for (const boundary of boundaries)
  test(`a fault ${boundary.name} keeps earlier points and a retry creates exactly one point`, async (t) => {
    const f = await setup(t);
    await publish(f);
    await publish(f, Buffer.alloc(3 * 1024 * 1024, 7));
    const { path: vault } = await newVault(t);
    const lease = { ARKVORY_BACKUP_LEASE_SECONDS: '2' };
    const previous = await capture(f, vault, 'previous');
    // Content not yet in the vault, so the faulty attempt really copies something.
    await publish(f);
    const reader = await FileVault.open(vault);
    const earlier = await reader.digest(previous.pointId, 'inventory.ndjson', never);
    await assert.rejects(capture(f, vault, 'faulty', boundary.wrap, lease), {
      code: 'unavailable',
    });
    const job = await captureJob(f, 'faulty');
    assert.equal(job.state, boundary.state);
    if (boundary.state === 'failed') {
      assert.equal(job.error_code, 'unavailable');
      assert.deepEqual(await protection(f), { barrier: 'open', pins: 0 });
    } else {
      // An unknown commit outcome keeps its pins until the lease expires and it is fenced.
      assert.deepEqual(await protection(f), { barrier: 'open', pins: 3 });
      await delay(2200);
    }
    assert.deepEqual(await reader.digest(previous.pointId, 'inventory.ndjson', never), earlier);
    assert.equal((await reader.point(previous.pointId)).jobId, previous.jobId);
    assert.equal((await committedPoints(vault)).length, boundary.adopted ? 2 : 1);
    const retried = await capture(f, vault, 'faulty', undefined, lease);
    assert.equal(retried.outcome, boundary.adopted ? 'existing' : 'created');
    assert.equal(retried.pointId, job.point_id);
    const done = await captureJob(f, 'faulty');
    assert.equal(done.state, 'completed');
    assert.equal(done.attempts, 2);
    assert.deepEqual(await protection(f), { barrier: 'open', pins: 0 });
    const replay = await capture(f, vault, 'faulty', undefined, lease);
    assert.equal(replay.outcome, 'existing');
    assert.equal(replay.pointId, job.point_id);
    assert.equal((await committedPoints(vault)).length, 2);
  });

test('a capture that dies keeps pins and barrier until its lease expires and it is fenced', async (t) => {
  const f = await setup(t);
  await enableCleanup(f);
  const kept = await publish(f);
  const { path: vault } = await newVault(t);
  const lease = { ARKVORY_BACKUP_LEASE_SECONDS: '2' };
  // Neither the barrier reopening nor the failure record reaches the database: a crash.
  const crash = (deps) => ({
    ...deps,
    barrier: override(deps.barrier, {
      reopen: async () => {
        throw injected();
      },
    }),
    jobs: override(deps.jobs, {
      fail: async () => {
        throw injected();
      },
    }),
  });
  await assert.rejects(capture(f, vault, 'crashed', crash, lease), { code: 'unavailable' });
  assert.deepEqual(await protection(f), { barrier: 'closed', pins: 1 });
  await retire(f, [kept.id]);
  assert.equal((await sweep(f)).last_deferred, 1);
  assert.equal(await onDisk(f, kept), true);
  await assert.rejects(capture(f, vault, 'another', undefined, lease), { code: 'busy' });
  await delay(2200);
  const other = await publish(f);
  const result = await capture(f, vault, 'crashed', undefined, lease);
  assert.equal(result.outcome, 'created');
  assert.equal(result.blobs, 1, 'the retry takes a new T');
  assert.deepEqual(await exportedPublished(vault, result.pointId), [other.id]);
  const job = await captureJob(f, 'crashed');
  assert.equal(job.state, 'completed');
  assert.equal(Number(job.generation), 3);
  assert.equal(job.attempts, 2);
  assert.deepEqual(await protection(f), { barrier: 'open', pins: 0 });
  await sweep(f);
  assert.equal(await onDisk(f, kept), false);
});

test('capture refuses unknown tables, legacy writers and a lost snapshot with machine codes', async (t) => {
  const f = await setup(t);
  await publish(f);
  const { path: vault } = await newVault(t);
  await f.catalog.pool.query('CREATE TABLE arkvory_zz_unregistered(id integer)');
  await assert.rejects(capture(f, vault, 'unknown'), { code: 'unknown_table' });
  assert.equal((await captureJob(f, 'unknown')).error_code, 'unknown_table');
  await f.catalog.pool.query('DROP TABLE arkvory_zz_unregistered');
  await assert.rejects(
    capture(f, vault, 'lost', (deps) => ({
      ...deps,
      vault: override(deps.vault, {
        async stage(pointId, attempt) {
          const staged = await deps.vault.stage(pointId, attempt);
          return override(staged, {
            async write(name, lines, cancellation) {
              if (name === 'tables/arkvory_users.ndjson')
                await f.catalog.pool.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity
                  WHERE datname=current_database() AND state='idle in transaction'
                  AND query LIKE '%descriptor->>%'`);
              return staged.write(name, lines, cancellation);
            },
          });
        },
      }),
    })),
    { code: 'snapshot_lost' },
  );
  assert.equal((await captureJob(f, 'lost')).error_code, 'snapshot_lost');
  assert.deepEqual(await protection(f), { barrier: 'open', pins: 0 });
  await f.app.close();
  const legacy = await f.catalog.pool.connect();
  try {
    await legacy.query('SELECT pg_advisory_lock(18471,3)');
    await assert.rejects(capture(f, vault, 'legacy'), { code: 'upgrade_required' });
  } finally {
    legacy.release(true);
  }
  assert.equal((await committedPoints(vault)).length, 0);
});

test('an attempt fenced by another process cannot commit its point', async (t) => {
  const f = await setup(t);
  await publish(f);
  const { path: vault } = await newVault(t);
  const copying = gate();
  const running = capture(
    f,
    vault,
    'fenced',
    (deps) => ({
      ...deps,
      vault: override(deps.vault, {
        async putBlob(entry, source, cancellation) {
          await copying.wait();
          return deps.vault.putBlob(entry, source, cancellation);
        },
      }),
    }),
    { ARKVORY_BACKUP_LEASE_SECONDS: '2' },
  );
  await copying.entered;
  // What a reconciler does after the lease expired: new generation, pins given back.
  await f.catalog.pool.query(`UPDATE arkvory_backup_jobs SET state='interrupted',
    error_code='interrupted', generation=generation+1, lease_owner=NULL, lease_until=NULL
    WHERE idempotency_key='fenced'`);
  await f.catalog.pool.query('DELETE FROM arkvory_backup_pins');
  copying.release();
  await assert.rejects(running, { code: 'lease_lost' });
  assert.equal((await committedPoints(vault)).length, 0);
  const job = await captureJob(f, 'fenced');
  assert.equal(job.state, 'interrupted');
  assert.equal(Number(job.generation), 2);
});

test('offline repair defers content that a backup pin protects and removes the rest', async (t) => {
  const f = await setup(t);
  const kept = await publish(f);
  const { path: vault } = await newVault(t);
  const failing = (deps) => ({
    ...deps,
    vault: override(deps.vault, {
      async stage(pointId, attempt) {
        const staged = await deps.vault.stage(pointId, attempt);
        return override(staged, {
          commit: async () => {
            throw injected();
          },
        });
      },
    }),
  });
  // An unknown commit outcome keeps the pins with an open barrier until fencing.
  await assert.rejects(capture(f, vault, 'unknown', failing), { code: 'unavailable' });
  const free = await publish(f);
  await retire(f, [kept.id, free.id]);
  assert.deepEqual(await protection(f), { barrier: 'open', pins: 1 });
  await f.app.close();
  const blobs = new LocalBlobStore(f.directory);
  const maintenance = new PostgresCatalog(f.config.databaseUrl, f.config.capacityBytes, 1);
  try {
    await maintenance.claimStorage(await blobs.identity(), 'maintenance');
    const result = await new GarbageCollector(new PostgresCleanup(maintenance.pool), blobs, {
      throwIfAborted() {
        if (!maintenance.active) throw new Error('Maintenance claim lost');
      },
    }).run(new Date().toISOString(), 0);
    assert.equal(result.collected, 1);
    assert.equal(result.deferred, 1);
  } finally {
    await maintenance.close();
  }
  assert.equal(await onDisk(f, kept), true);
  assert.equal(await onDisk(f, free), false);
  assert.equal((await upload(f, kept.id)).reclaimed, false);
});
