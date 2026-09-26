import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { ArkvoryError } from '@proanima/arkvory-domain';
import { BandwidthGovernor } from '@proanima/arkvory-infrastructure';
import { createContentSender, registerDownloadRoutes } from '../apps/api/dist/download-routes.js';
import { createRequestContext } from '../apps/api/dist/request-context.js';
import { registerHttpErrors } from '../apps/api/dist/http-errors.js';

async function fixture(t, { download, bandwidth, check, signal, read } = {}) {
  const app = Fastify();
  const context = createRequestContext();
  const owner = { id: 'reader', repositories: ['releases'], permissions: ['read'] };
  const bytes = Buffer.alloc(65536, 0x57);
  const events = [];
  const slotReleased = Promise.withResolvers();
  let slots = 0,
    pins = 0,
    reads = 0,
    returned = 0;
  const governor =
    bandwidth ??
    new BandwidthGovernor({ bytesPerSecond: 0, perPrincipalBytesPerSecond: 0 }, ['reader']);
  const sender = createContentSender({
    service: {
      async download() {
        await download?.();
        return {
          upload: { descriptor: { size: bytes.length, sha256: 'a'.repeat(64), name: 'file.bin' } },
          async *read() {
            reads++;
            try {
              await read?.();
              yield bytes;
            } finally {
              returned++;
            }
          },
        };
      },
    },
    downloadGate: {
      async acquire() {
        slots++;
        return () => {
          slots--;
          slotReleased.resolve();
        };
      },
    },
    downloadBandwidth: governor,
    diagnostics: {
      write(event) {
        events.push(event);
      },
    },
    principal: () => owner,
    signal: signal ?? context.signal,
    pins: {
      async acquire() {
        pins++;
        return {
          check: check ?? (() => {}),
          async release() {
            pins--;
          },
        };
      },
    },
  });
  registerHttpErrors(app, context);
  registerDownloadRoutes(
    app,
    {
      common: async () => 'artifact',
      universal: async () => 'artifact',
      asset: async () => 'artifact',
    },
    () => owner,
    sender,
  );
  t.after(async () => {
    governor.close();
    await app.close();
  });
  return {
    app,
    events,
    slotReleased: slotReleased.promise,
    state: () => ({ slots, pins, reads, returned }),
  };
}

test('pin loss during metadata lookup rejects HEAD, conditional and range responses before success', async (t) => {
  let protectedBlob = true;
  const f = await fixture(t, {
    download() {
      protectedBlob = false;
    },
    check() {
      if (!protectedBlob) throw new ArkvoryError('unavailable', 'Protection lost');
    },
  });
  for (const request of [
    { method: 'HEAD' },
    { headers: { 'if-none-match': '"sha256:' + 'a'.repeat(64) + '"' } },
    { headers: { range: 'bytes=999999-' } },
  ]) {
    protectedBlob = true;
    const response = await f.app.inject({
      url: '/api/v1/repositories/releases/artifacts/artifact/content',
      ...request,
    });
    assert.equal(response.statusCode, 503);
    assert.equal(response.headers.etag, undefined);
  }
  assert.deepEqual(f.state(), { slots: 0, pins: 0, reads: 0, returned: 0 });
});

test('cancellation while resolving metadata does not return a successful empty response', async (t) => {
  const stop = new AbortController();
  const f = await fixture(t, {
    download() {
      stop.abort();
    },
    signal: () => stop.signal,
  });
  const response = await f.app.inject({
    method: 'HEAD',
    url: '/api/v1/repositories/releases/artifacts/artifact/content',
  });
  assert.equal(response.statusCode, 503);
  assert.deepEqual(f.state(), { slots: 0, pins: 0, reads: 0, returned: 0 });
});

test('a failure before the first byte returns JSON without the file representation headers', async (t) => {
  const f = await fixture(t, {
    read() {
      throw new ArkvoryError('unavailable', 'Content protection lost');
    },
  });
  const response = await f.app.inject({
    url: '/api/v1/repositories/releases/artifacts/artifact/content',
    headers: { range: 'bytes=0-31' },
  });
  assert.equal(response.statusCode, 503, response.body);
  assert.equal(response.json().code, 'unavailable');
  assert.equal(response.headers['retry-after'], '2');
  assert.match(response.headers['content-type'], /^application\/json/);
  assert.equal(Number(response.headers['content-length']), response.rawPayload.length);
  for (const header of [
    'etag',
    'last-modified',
    'content-range',
    'accept-ranges',
    'content-disposition',
  ])
    assert.equal(response.headers[header], undefined, header);
  await f.slotReleased;
  assert.deepEqual(f.state(), { slots: 0, pins: 0, reads: 1, returned: 1 });
});

test('native and legacy delivery discard a buffered quantum when its pin is lost during pacing', async (t) => {
  for (const path of [
    '/api/v1/repositories/releases/artifacts/artifact/content',
    '/api/packages/releases/download',
    '/upack/releases/download/file',
    '/endpoints/releases/content/file',
  ]) {
    await t.test(path, { timeout: 5000 }, async (t) => {
      let protectedBlob = true,
        now = 0,
        pending;
      const clock = {
        now: () => now,
        schedule(action, delay) {
          pending = () => {
            now += delay;
            action();
          };
          return () => {
            pending = undefined;
          };
        },
      };
      const bandwidth = new BandwidthGovernor(
        { bytesPerSecond: 65536, perPrincipalBytesPerSecond: 0 },
        ['reader'],
        () => true,
        clock,
      );
      const f = await fixture(t, {
        bandwidth,
        check() {
          if (!protectedBlob) throw new ArkvoryError('unavailable', 'Protection lost');
        },
      });
      const address = await f.app.listen({ host: '127.0.0.1', port: 0 });
      const response = await fetch(address + path);
      assert.equal(response.status, 200);
      const reader = response.body.getReader();
      let received = 0;
      while (received < bandwidth.quantum) {
        const first = await reader.read();
        assert.equal(first.done, false);
        received += first.value.length;
      }
      assert.equal(received, bandwidth.quantum);
      assert.equal(bandwidth.snapshot.waiting, 1);
      const tail = reader.read();
      const interrupted = assert.rejects(tail);
      protectedBlob = false;
      assert.equal(typeof pending, 'function');
      pending();
      await interrupted;
      reader.releaseLock();
      // The client observes the reset before the server's socket close event releases admission.
      await f.slotReleased;
      await f.app.close();
      assert.deepEqual(f.state(), { slots: 0, pins: 0, reads: 1, returned: 1 });
      assert.equal(bandwidth.snapshot.waiting, 0);
      assert.equal(f.events.filter((event) => event.code === 'download.read_failed').length, 1);
    });
  }
});
