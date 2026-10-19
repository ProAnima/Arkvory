import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { recoverDerivedCacheOwner } from '@proanima/arkvory-infrastructure';
import {
  cacheFixture,
  signal,
  reservation,
  writeBuild,
  assertRead,
} from './derived-cache-fixture.mjs';

async function childBuilder(f) {
  const child = fork(new URL('./derived-cache-child.mjs', import.meta.url), [], {
    silent: true,
    windowsHide: true,
  });
  let stderr = '';
  child.stdout.resume();
  child.stderr.on('data', (data) => {
    stderr = (stderr + data.toString()).slice(-16384);
  });
  const exited = new Promise((resolve) =>
    child.once('exit', (code, signal) => resolve({ code, signal })),
  );
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await Promise.race([
      exited,
      new Promise((_, reject) => {
        const timer = setTimeout(() => reject(new Error('child failed to exit')), 10000);
        timer.unref();
      }),
    ]);
  };
  f.beforeClose.push(stop);
  const message = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`child startup timeout: ${stderr}`)), 20000);
    child.once('error', reject);
    child.once('exit', () => reject(new Error(`child exited before ready: ${stderr}`)));
    child.once('message', (result) => {
      clearTimeout(timer);
      resolve(result);
    });
    child.send({
      databaseUrl: f.config.databaseUrl,
      directory: f.directory,
      moduleId: f.moduleId,
      quota: reservation,
    });
  });
  assert.equal(message.state, 'ready', message.error);
  assert.match(message.ownerId, /^[0-9a-f-]{36}$/);
  return { ownerId: message.ownerId, stop };
}

test('derived cache: confirmed process exit permits recovery; PG disappearance alone does not', async (t) => {
  const f = await cacheFixture(t);
  const child = await childBuilder(f);
  const survivor = f.create().cache;
  assert.equal(await survivor.begin('before-kill', reservation, signal), null);
  await assert.rejects(
    recoverDerivedCacheOwner(f.catalog.pool, child.ownerId, { confirmedStopped: true }),
    'even trusted admin recovery must reject an owner with a live PG lock',
  );
  await child.stop(); // Explicit OS exit is the evidence; PG session disappearance is not evidence.
  await survivor.reconcile();
  assert.equal(await survivor.open('killed-build', signal), null);
  assert.equal(
    await survivor.begin('before-confirmation', reservation, signal),
    null,
    'reconcile must conservatively retain the dead owner charge before explicit confirmation',
  );
  await recoverDerivedCacheOwner(f.catalog.pool, child.ownerId, { confirmedStopped: true });
  await survivor.reconcile();
  const build = await survivor.begin('recovered', reservation, signal);
  assert.ok(build, 'confirmed dead process cleanup must actually return the reservation');
  const expected = { payload: Buffer.alloc(8192, 29) };
  await writeBuild(build, expected);
  await build.commit(signal);
  const reader = await survivor.open('recovered', signal);
  try {
    await assertRead(reader, expected);
  } finally {
    await reader?.release();
  }
});

test('derived cache: lost reader session cannot silently free a live reader reservation', async (t) => {
  const f = await cacheFixture(t);
  const writer = f.create().cache;
  const reading = f.create();
  const build = await writer.begin('read-loss', reservation, signal);
  assert.ok(build);
  const expected = { payload: Buffer.alloc(48 * 1024, 31) };
  await writeBuild(build, expected);
  await build.commit(signal);
  const reader = await reading.cache.open('read-loss', signal);
  assert.ok(reader);
  const iterator = reader.read('payload')[Symbol.asyncIterator]();
  const first = await iterator.next();
  assert.equal(first.done, false);
  assert.deepEqual(Buffer.from(first.value), expected.payload.subarray(0, first.value.length));
  await f.terminate(reading);
  await writer.reconcile();
  assert.equal(
    await writer.begin('pressure', reservation, signal),
    null,
    'lost PG pin is not proof that the paused reader has closed its descriptor',
  );
  await assert.rejects(reader.stat('payload'));
  await iterator.return();
  await reader.release();
  await reading.cache.close();
  await writer.reconcile();
  const next = await writer.begin('pressure', reservation, signal);
  assert.ok(next, 'drained graceful close permits reclaiming the old reader protection');
  await next.abort();
});
