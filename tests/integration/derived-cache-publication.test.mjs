import test from 'node:test';
import assert from 'node:assert/strict';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import {
  cacheFixture,
  signal,
  reservation,
  writeBuild,
  assertRead,
} from './derived-cache-fixture.mjs';

async function deadline(promise) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('failure probe did not reach its boundary')),
          10000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function generation(f, key) {
  const result = await f.catalog.pool.query(
    `SELECT g.id,g.fence::text,g.state,g.manifest_hash,e.current_id
    FROM arkvory_derived_cache_generations g JOIN arkvory_derived_cache_entries e
    ON e.module_id=g.module_id AND e.key=g.key WHERE g.module_id=$1 AND g.key=$2`,
    [f.moduleId, key],
  );
  assert.equal(result.rowCount, 1, 'exactly one generation, not a replacement retry');
  return result.rows[0];
}

async function completeRead(cache, key, expected) {
  const reader = await cache.open(key, signal);
  try {
    await assertRead(reader, expected);
  } finally {
    await reader?.release();
  }
}

test('derived cache: lost publish COMMIT response retries the same durable generation', async (t) => {
  const f = await cacheFixture(t);
  const instance = f.create();
  let armed = false;
  let injected = 0;
  const lostResponse = new Error('publish COMMIT response lost after real commit');
  instance.pool.on('connect', (client) => {
    const query = client.query;
    t.mock.method(client, 'query', function (...args) {
      const result = query.apply(this, args);
      if (args[0] !== 'COMMIT' || !armed) return result;
      armed = false;
      return result.then(() => {
        injected++;
        throw lostResponse;
      });
    });
  });
  const build = await instance.cache.begin('uncertain', reservation, signal);
  assert.ok(build);
  const before = await generation(f, 'uncertain');
  const expected = { root: Buffer.from('publication root'), 'pages/one': Buffer.alloc(8192, 47) };
  await writeBuild(build, expected);
  armed = true; // Admission already committed; only the real publication COMMIT is intercepted.
  await assert.rejects(build.commit(signal), (error) => error === lostResponse);
  assert.equal(injected, 1);
  const committed = await generation(f, 'uncertain');
  assert.equal(committed.id, before.id);
  assert.equal(committed.fence, before.fence);
  assert.equal(committed.current_id, before.id);
  assert.equal(committed.state, 'ready');
  assert.match(committed.manifest_hash, /^[a-f0-9]{64}$/);
  const independent = f.create().cache;
  await completeRead(independent, 'uncertain', expected);
  await build.commit(signal);
  assert.deepEqual(await generation(f, 'uncertain'), committed);
  await build.abort();
  await instance.cache.reconcile();
  assert.deepEqual(await generation(f, 'uncertain'), committed);
  await completeRead(independent, 'uncertain', expected);
});

test('derived cache: delayed native write cannot publish after session loss; drain permits a fresh generation', async (t) => {
  const f = await cacheFixture(t);
  const old = f.create();
  const survivor = f.create().cache;
  const build = await old.cache.begin('late-owner', reservation, signal);
  assert.ok(build);
  const before = await generation(f, 'late-owner');
  const sink = await build.create('pending');
  const probe = await open(join(f.directory, 'filehandle-probe'), 'wx');
  const prototype = Object.getPrototypeOf(probe);
  await probe.close();
  const nativeWrite = prototype.write;
  const entered = Promise.withResolvers();
  const resume = Promise.withResolvers();
  const bytes = Buffer.alloc(4096, 61);
  let actualBytes = 0;
  const interception = t.mock.method(prototype, 'write', async function (...args) {
    if (args[0] !== bytes) return nativeWrite.apply(this, args);
    entered.resolve();
    await resume.promise;
    // Resume the genuine filesystem write after PG ownership is lost, not a fake sink result.
    const result = await nativeWrite.apply(this, args);
    actualBytes += result.bytesWritten;
    return result;
  });
  const writing = sink.write(bytes);
  const settledWrite = Promise.allSettled([writing]);
  f.beforeClose.push(async () => {
    resume.resolve();
    await deadline(settledWrite);
    interception.mock.restore();
  });
  await deadline(entered.promise);
  await f.terminate(old);
  await survivor.reconcile();
  assert.equal(await survivor.begin('late-owner', reservation, signal), null);
  assert.equal(
    await survivor.begin('other-key', reservation, signal),
    null,
    'lost owner retains full charge',
  );
  let closed = false;
  const closing = old.cache.close().then(() => {
    closed = true;
  });
  const settledClose = Promise.allSettled([closing]);
  const state = await f.catalog.pool.query(
    'SELECT quiescent FROM arkvory_derived_cache_owners WHERE id=$1',
    [old.cache.ownerId],
  );
  assert.deepEqual(state.rows, [{ quiescent: false }]);
  assert.equal(closed, false, 'close cannot attest quiescence while native write is pending');
  resume.resolve();
  await deadline(settledWrite);
  await deadline(closing);
  assert.equal((await settledClose)[0].status, 'fulfilled');
  assert.equal(
    actualBytes,
    bytes.length,
    'the delayed syscall must really write to the old namespace',
  );
  interception.mock.restore();
  await assert.rejects(build.commit(signal));
  assert.equal(await survivor.open('late-owner', signal), null);
  await survivor.reconcile(); // Normal close proved OS quiescence; no timeout/PID inference.
  const fresh = await survivor.begin('late-owner', reservation, signal);
  assert.ok(fresh);
  const next = await generation(f, 'late-owner');
  assert.notEqual(next.id, before.id, 'old physical namespace must never be reused');
  const expected = { pending: Buffer.from('new owner data'), marker: Buffer.from('new root') };
  await writeBuild(fresh, expected);
  await fresh.commit(signal);
  await assert.rejects(sink.write(Buffer.from('late mutation')));
  await assert.rejects(build.commit(signal));
  const published = await generation(f, 'late-owner');
  assert.equal(published.id, next.id);
  assert.equal(published.fence, next.fence);
  assert.equal(published.current_id, next.id);
  await completeRead(survivor, 'late-owner', expected);
});
