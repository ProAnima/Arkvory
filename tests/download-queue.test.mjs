import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DownloadQueue,
  DownloadQueueError,
  checkpointedDownload,
  DepotIntegrityError,
} from '@proanima/depot-sdk';

test('overlapping cancel-all calls preserve admission state and do not start newly queued work during cleanup', async () => {
  const queue = new DownloadQueue({ concurrency: 2, startIntervalMs: 0 });
  const saving = deferred(),
    starts = [];
  queue.enqueue({
    id: 'save',
    async run(c) {
      c.beginCommit();
      await saving.promise;
    },
    async discard() {},
  });
  await tick();
  const first = queue.cancelAll(),
    second = queue.cancelAll();
  const next = job('next', starts);
  queue.enqueue(next);
  await tick();
  assert.deepEqual(starts, []);
  saving.resolve();
  await Promise.all([first, second]);
  await tick();
  assert.deepEqual(starts, ['next']);
  assert.equal(queue.paused, false);
  await queue.close();
});

test('a failed checkpoint write aborts the writer and preserves the sealed prefix without committing', async () => {
  let aborted = 0,
    closed = 0,
    committed = 0;
  const disk = {
    async prefix() {
      return new Blob(['old']);
    },
    async append(offset) {
      assert.equal(offset, 3);
      return new WritableStream({
        write() {
          throw new Error('disk full');
        },
        close() {
          closed++;
        },
        abort() {
          aborted++;
        },
      });
    },
    async commit() {
      committed++;
    },
    async discard() {},
  };
  const client = {
    async downloadVerified() {
      return new ReadableStream({
        start(c) {
          c.enqueue(new Uint8Array([1]));
          c.close();
        },
      });
    },
  };
  const queue = new DownloadQueue();
  queue.enqueue(checkpointedDownload(client, 'disk', 'repo', 'id', disk));
  await tick();
  assert.equal(queue.snapshot[0].state, 'failed');
  assert.equal(closed, 0);
  assert.equal(committed, 0);
  // An errored WHATWG writer may already be aborted internally, so no further abort callback is required.
  assert.ok(aborted <= 1);
  assert.equal(await (await disk.prefix()).text(), 'old');
  await queue.close();
});

const tick = async () => {
  for (let i = 0; i < 25; i++) await Promise.resolve();
};
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
function time() {
  let now = 0;
  const timers = new Set();
  return {
    now: () => now,
    schedule(fn, ms) {
      const t = { fn, at: now + ms };
      timers.add(t);
      return () => timers.delete(t);
    },
    advance(ms) {
      const target = now + ms;
      for (;;) {
        const t = [...timers].sort((a, b) => a.at - b.at)[0];
        if (!t || t.at > target) break;
        now = t.at;
        timers.delete(t);
        t.fn();
      }
      now = target;
    },
    get timers() {
      return timers.size;
    },
  };
}
function job(id, started = [], checkpoint = Promise.resolve()) {
  const done = deferred();
  let discarded = 0;
  return {
    id,
    done,
    get discarded() {
      return discarded;
    },
    async run(context) {
      started.push(id);
      const aborted = new Promise((_, reject) =>
        context.signal.addEventListener('abort', () => reject(context.signal.reason), {
          once: true,
        }),
      );
      try {
        await Promise.race([done.promise, aborted]);
      } catch (error) {
        await checkpoint;
        throw error;
      }
      context.beginCommit();
    },
    async discard() {
      discarded++;
    },
  };
}
test('download scheduler bounds entries and whole-transfer concurrency, applies launch spacing and expires waiting jobs', async () => {
  const clock = time(),
    queue = new DownloadQueue(
      { concurrency: 2, maxEntries: 3, startIntervalMs: 100, queueTimeoutMs: 150 },
      clock,
    ),
    starts = [];
  const a = job('a', starts),
    b = job('b', starts),
    c = job('c', starts);
  queue.enqueue(a);
  queue.enqueue(b);
  queue.enqueue(c);
  await tick();
  assert.deepEqual(starts, ['a']);
  assert.throws(() => queue.enqueue(job('d')), { code: 'queue_full' });
  clock.advance(100);
  await tick();
  assert.deepEqual(starts, ['a', 'b']);
  clock.advance(50);
  assert.equal(queue.snapshot[2].error.code, 'wait_timeout');
  queue.configure({ concurrency: 1 });
  a.done.resolve();
  await tick();
  queue.resume('c');
  clock.advance(100);
  await tick();
  assert.deepEqual(starts, ['a', 'b']);
  b.done.resolve();
  await tick();
  assert.deepEqual(starts, ['a', 'b', 'c']);
  c.done.resolve();
  await tick();
  await queue.clearFinished();
  assert.equal(queue.snapshot.length, 0);
  await queue.close();
  assert.equal(clock.timers, 0);
  assert.throws(() => queue.enqueue(job('x')), { code: 'closed' });
});
test('pause waits for checkpoint before freeing a slot and resume-all handles a still-pausing job', async () => {
  const clock = time(),
    queue = new DownloadQueue({ concurrency: 1, startIntervalMs: 0 }, clock),
    starts = [],
    checkpoint = deferred();
  const a = job('a', starts, checkpoint.promise),
    b = job('b', starts);
  queue.enqueue(a);
  queue.enqueue(b);
  await tick();
  queue.pause('a');
  await tick();
  assert.equal(queue.snapshot[0].state, 'pausing');
  assert.equal(queue.resume('a'), false);
  assert.deepEqual(starts, ['a']);
  queue.resumeAll();
  checkpoint.resolve();
  await tick();
  assert.deepEqual(starts, ['a', 'b']);
  b.done.resolve();
  await tick();
  assert.deepEqual(starts, ['a', 'b', 'a']);
  a.done.resolve();
  await tick();
  await queue.close();
});
test('clearing waiting jobs never starts them or cancels active work; cleanup failure is visible and cancellation cannot be resumed', async () => {
  const queue = new DownloadQueue({ concurrency: 1, startIntervalMs: 0 }),
    starts = [],
    a = job('a', starts),
    b = job('b', starts),
    c = job('c', starts);
  queue.enqueue(a);
  queue.enqueue(b);
  queue.enqueue(c);
  await tick();
  queue.pause('c');
  await queue.clearWaiting();
  assert.deepEqual(starts, ['a']);
  assert.equal(a.discarded, 0);
  assert.equal(b.discarded, 1);
  assert.equal(c.discarded, 1);
  await queue.clearFinished();
  assert.equal(queue.snapshot.length, 1);
  const bad = job('bad');
  bad.discard = async () => {
    throw new Error('disk unavailable');
  };
  queue.enqueue(bad);
  await queue.cancel('bad');
  assert.equal(queue.snapshot[1].state, 'failed');
  assert.equal(queue.snapshot[1].resumable, false);
  assert.equal(queue.resume('bad'), false);
  assert.equal(await queue.remove('bad'), false);
  bad.discard = async () => {};
  assert.equal(await queue.remove('bad'), true);
  await queue.cancelAll();
  assert.equal(queue.snapshot[0].state, 'cancelled');
  await queue.close();
});
test('final commit cannot be interrupted and close waits for it; observers and snapshots cannot corrupt scheduler state', async () => {
  const queue = new DownloadQueue({ startIntervalMs: 0 }),
    saving = deferred();
  let commits = 0;
  queue.subscribe(() => {
    throw new Error('observer');
  });
  queue.enqueue({
    id: 'a',
    async run(c) {
      c.retry({ attempt: 1, delayMs: 100 });
      c.progress(8);
      c.beginCommit();
      await saving.promise;
      commits++;
    },
    async discard() {},
  });
  await tick();
  assert.equal(queue.snapshot[0].state, 'saving');
  assert.equal(queue.pause('a'), false);
  assert.equal(await queue.cancel('a'), false);
  const copy = queue.snapshot;
  copy[0].state = 'failed';
  assert.equal(queue.snapshot[0].state, 'saving');
  let closed = false;
  const closing = queue.close().then(() => {
    closed = true;
  });
  await tick();
  assert.equal(closed, false);
  saving.resolve();
  await closing;
  assert.equal(commits, 1);
  assert.equal(queue.snapshot[0].state, 'completed');
});
test('invalid policies and duplicate IDs fail before work, synchronous task failures can be explicitly retried', async () => {
  for (const options of [
    { concurrency: 0 },
    { concurrency: 9 },
    { maxEntries: 257 },
    { startIntervalMs: -1 },
    { queueTimeoutMs: Infinity },
  ])
    assert.throws(() => new DownloadQueue(options), DownloadQueueError);
  const queue = new DownloadQueue({ startIntervalMs: 0 });
  let attempts = 0;
  queue.enqueue({
    id: 'a',
    run() {
      attempts++;
      throw new Error('failure');
    },
    async discard() {},
  });
  assert.throws(() => queue.enqueue(job('a')), { code: 'duplicate' });
  await tick();
  assert.equal(queue.snapshot[0].state, 'failed');
  queue.resume('a');
  await tick();
  assert.equal(attempts, 2);
  await queue.close();
});
function storage() {
  let sealed = new Uint8Array(),
    committed,
    discarded = 0;
  return {
    get sealed() {
      return sealed;
    },
    get committed() {
      return committed;
    },
    get discarded() {
      return discarded;
    },
    async prefix() {
      return new Blob([sealed]);
    },
    async append(offset) {
      assert.equal(offset, sealed.length);
      let chunks = [sealed];
      return new WritableStream({
        write(bytes) {
          chunks.push(bytes.slice());
        },
        close() {
          sealed = Buffer.concat(chunks);
        },
        abort() {},
      });
    },
    async commit() {
      committed = sealed.slice();
    },
    async discard() {
      discarded++;
      sealed = new Uint8Array();
    },
  };
}
test('checkpointed download seals complete writes on pause and resumes from prefix without publishing partial bytes', async () => {
  const disk = storage(),
    queue = new DownloadQueue({ startIntervalMs: 0 });
  let requests = 0;
  const client = {
    async downloadVerified(_r, _id, options) {
      const prefix = await options.prefix.arrayBuffer();
      assert.equal(prefix.byteLength, requests ? 3 : 0);
      requests++;
      let n = 0;
      return new ReadableStream(
        {
          async pull(c) {
            if (!n++) {
              c.enqueue(new Uint8Array([1, 2, 3]));
              return;
            }
            if (requests === 1) {
              await new Promise((_, reject) =>
                options.signal.addEventListener('abort', () => reject(options.signal.reason), {
                  once: true,
                }),
              );
            }
            c.close();
          },
        },
        { highWaterMark: 0 },
      );
    },
  };
  queue.enqueue(checkpointedDownload(client, 'a', 'repo', 'artifact', disk));
  await tick();
  queue.pause('a');
  await tick();
  assert.equal(queue.snapshot[0].state, 'paused');
  assert.deepEqual([...disk.sealed], [1, 2, 3]);
  assert.equal(disk.committed, undefined);
  queue.resume('a');
  await tick();
  assert.equal(queue.snapshot[0].state, 'completed');
  assert.deepEqual([...disk.committed], [1, 2, 3, 1, 2, 3]);
  await queue.clearFinished();
  assert.equal(disk.sealed.length, 0);
});
test('integrity rejection removes the checkpoint and never commits a file', async () => {
  const disk = storage(),
    queue = new DownloadQueue();
  const client = {
    async downloadVerified() {
      return new ReadableStream({
        pull(c) {
          c.error(new DepotIntegrityError());
        },
      });
    },
  };
  queue.enqueue(checkpointedDownload(client, 'bad', 'repo', 'id', disk));
  await tick();
  assert.equal(queue.snapshot[0].state, 'failed');
  assert.equal(disk.discarded, 1);
  assert.equal(disk.committed, undefined);
  await queue.close();
});
