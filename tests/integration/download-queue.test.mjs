import test from 'node:test';
import assert from 'node:assert/strict';
import { openAsBlob } from 'node:fs';
import { writeFile, appendFile, readFile, copyFile, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { ArkvoryClient, DownloadQueue, checkpointedDownload } from '@proanima/arkvory-sdk';
import { setup, create, base } from './fixture.mjs';

async function until(queue, id, state) {
  if (queue.snapshot.find((item) => item.id === id)?.state === state) return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error(`Expected ${state}: ${JSON.stringify(queue.snapshot)}`));
    }, 10000);
    const off = queue.subscribe(() => {
      if (queue.snapshot.find((item) => item.id === id)?.state === state) {
        clearTimeout(timer);
        off();
        resolve();
      }
    });
  });
}
test('queued verified HTTP download pauses to disk, resumes with Range and cleans staging without changing the destination on cancel', async (t) => {
  const f = await setup(t);
  const ranges = [];
  f.app.addHook('onRequest', async (request) => {
    if (request.method === 'GET' && request.url.endsWith('/content'))
      ranges.push(request.headers.range);
  });
  const bytes = Buffer.alloc(8 * 1024 ** 2 + 123, 0x39),
    id = (await create(f, bytes)).json().id;
  assert.equal(
    (
      await f.app.inject({
        method: 'PUT',
        url: `${base}/uploads/${id}/content`,
        headers: { ...f.headers, 'content-type': 'application/octet-stream' },
        payload: bytes,
      })
    ).statusCode,
    200,
  );
  const address = await f.listen(),
    client = new ArkvoryClient(address, () => f.headers.authorization.slice(7));
  const queue = new DownloadQueue({ concurrency: 1, startIntervalMs: 0 });
  t.after(() => queue.close());
  const checkpoint = join(f.directory, 'download.part'),
    staging = checkpoint + '.writing',
    destination = join(f.directory, 'download.final');
  await writeFile(checkpoint, Buffer.alloc(0));
  await writeFile(destination, 'old destination');
  let pauseOnce = true;
  const storage = {
    async prefix() {
      try {
        return await openAsBlob(checkpoint);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        return new Blob();
      }
    },
    async append(offset) {
      if (offset) await copyFile(checkpoint, staging);
      else await writeFile(staging, Buffer.alloc(0));
      return new WritableStream({
        async write(chunk) {
          await appendFile(staging, chunk);
          if (pauseOnce) {
            pauseOnce = false;
            queue.pause('file');
          }
        },
        async close() {
          await rename(staging, checkpoint);
        },
        async abort() {
          await rm(staging, { force: true });
        },
      });
    },
    async commit() {
      await copyFile(checkpoint, destination + '.ready');
      await rename(destination + '.ready', destination);
    },
    async discard() {
      await rm(checkpoint, { force: true });
      await rm(staging, { force: true });
    },
  };
  queue.enqueue(checkpointedDownload(client, 'file', 'releases', id, storage));
  await until(queue, 'file', 'paused');
  assert.equal((await stat(checkpoint)).size, 8 * 1024 ** 2);
  assert.equal(await readFile(destination, 'utf8'), 'old destination');
  queue.resume('file');
  await until(queue, 'file', 'completed');
  assert.deepEqual(await readFile(destination), bytes);
  assert.deepEqual(ranges, [
    `bytes=0-${8 * 1024 ** 2 - 1}`,
    `bytes=${8 * 1024 ** 2}-${bytes.length - 1}`,
  ]);
  // Close waits for the completed task's temporary cleanup as well.
  await queue.close();
  await assert.rejects(stat(checkpoint), { code: 'ENOENT' });
  const cancelled = new DownloadQueue({ startIntervalMs: 0 });
  cancelled.pauseAll();
  cancelled.enqueue(checkpointedDownload(client, 'cancel', 'releases', id, storage));
  await writeFile(checkpoint, 'temporary');
  await cancelled.clearWaiting();
  await cancelled.close();
  assert.deepEqual(await readFile(destination), bytes);
  await assert.rejects(stat(checkpoint), { code: 'ENOENT' });
  assert.equal(
    (await f.app.inject({ url: '/health/ready', headers: f.headers })).json().transfers.downloads
      .admission.active,
    0,
  );
});

test('configured server admission exposes queue bounds and rejects a waiting download on its deadline', async (t) => {
  const f = await setup(t, {
    maxDownloads: 1,
    downloadBytesPerSecond: 65536,
    transferQueueLimit: 1,
    transferQueuePerPrincipal: 1,
    transferQueueTimeoutMs: 40,
  });
  const bytes = Buffer.alloc(128 * 1024, 0x41),
    id = (await create(f, bytes)).json().id;
  await f.app.inject({
    method: 'PUT',
    url: `${base}/uploads/${id}/content`,
    headers: { ...f.headers, 'content-type': 'application/octet-stream' },
    payload: bytes,
  });
  const address = await f.listen(),
    abort = new AbortController();
  const first = await fetch(`${address}${base}/artifacts/${id}/content`, {
    headers: f.headers,
    signal: abort.signal,
  });
  const second = await fetch(`${address}${base}/artifacts/${id}/content`, {
    headers: f.readerHeaders,
  });
  assert.equal(second.status, 503);
  assert.ok(second.headers.get('retry-after'));
  await second.body.cancel();
  const admission = (await f.app.inject({ url: '/health/ready', headers: f.headers })).json()
    .transfers.downloads.admission;
  assert.equal(admission.waitingCapacity, 1);
  assert.equal(admission.perPrincipalWaitingCapacity, 1);
  assert.equal(admission.timeoutMs, 40);
  assert.equal(admission.timedOut, 1);
  abort.abort();
  await first.body.cancel().catch(() => {});
});
