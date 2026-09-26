import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { GarbageCollector } from '@proanima/arkvory-application';
import { ArkvoryError } from '@proanima/arkvory-domain';
import {
  LocalBlobStore,
  PostgresCatalog,
  PostgresCleanup,
  PostgresContentPins,
} from '@proanima/arkvory-infrastructure';
import { setup, create, base } from './fixture.mjs';

test('offline GC keeps per-object protection when its maintenance session dies and refuses further unlink', async (t) => {
  const f = await setup(t);
  const bytes = Buffer.from('preserve bytes across maintenance session failure');
  const id = (await create(f, bytes)).json().id;
  const published = await f.app.inject({
    method: 'PUT',
    url: `${base}/uploads/${id}/content`,
    headers: { ...f.headers, 'content-type': 'application/octet-stream' },
    payload: bytes,
  });
  assert.equal(published.statusCode, 200, published.body);
  await f.catalog.pool.query(
    "UPDATE arkvory_uploads SET status='cancelled',cancelled_at=now()-interval '2 days' WHERE id=$1",
    [id],
  );
  await f.app.close();
  const blobs = new LocalBlobStore(f.directory);
  const maintenance = new PostgresCatalog(f.config.databaseUrl, f.config.capacityBytes, 1);
  const pins = new PostgresContentPins(f.catalog.pool);
  const entered = Promise.withResolvers();
  const resume = Promise.withResolvers();
  let running;
  try {
    await maintenance.claimStorage(await blobs.identity(), 'maintenance');
    const gc = new GarbageCollector(
      new PostgresCleanup(maintenance.pool),
      {
        async collect(...args) {
          entered.resolve();
          await resume.promise;
          return blobs.collect(...args);
        },
      },
      {
        throwIfAborted() {
          if (!maintenance.active) throw new ArkvoryError('unavailable', 'Maintenance claim lost');
        },
      },
    );
    running = gc.run(new Date().toISOString()).then(
      () => null,
      (error) => error,
    );
    await entered.promise;
    const terminated = await f.catalog.pool.query(`SELECT pg_terminate_backend(pid) AS stopped
      FROM pg_locks WHERE locktype='advisory' AND classid=18471 AND objid=4
      AND objsubid=2 AND mode='ExclusiveLock' AND granted
      AND database=(SELECT oid FROM pg_database WHERE datname=current_database())`);
    assert.equal(terminated.rows.length, 1);
    assert.equal(terminated.rows[0].stopped, true);
    for (let attempt = 0; maintenance.active && attempt < 100; attempt++) await delay(10);
    assert.equal(maintenance.active, false);
    await f.restart();
    await assert.rejects(pins.acquire(id), { code: 'busy' });
    await assert.rejects(
      f.catalog.exclusive(id, async () => undefined),
      { code: 'busy' },
    );
    resume.resolve();
    assert.equal((await running).code, 'unavailable');
    assert.deepEqual(await readFile(blobs.contentPath(id)), bytes);
    assert.equal(
      (await f.catalog.pool.query('SELECT reclaimed FROM arkvory_uploads WHERE id=$1', [id]))
        .rows[0].reclaimed,
      false,
    );
    const released = await pins.acquire(id);
    await released.release();
  } finally {
    resume.resolve();
    await running;
    await pins.close();
    await maintenance.close();
  }
});
