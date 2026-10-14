import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { downloadSchedulePolicy } from '@proanima/arkvory-domain';
import {
  AdmissionQueue,
  BandwidthGovernor,
  DownloadScheduler,
} from '@proanima/arkvory-infrastructure';
import { createContentSender, registerDownloadRoutes } from '../apps/api/dist/download-routes.js';
import { createDownloadAdmission } from '../apps/api/dist/download-admission.js';
import { createRequestContext } from '../apps/api/dist/request-context.js';
import { registerHttpErrors } from '../apps/api/dist/http-errors.js';

const bytes = Buffer.alloc(4096, 0x41);
const url = '/api/v1/repositories/releases/artifacts/artifact/content';

async function server(t, policy) {
  const app = Fastify();
  const context = createRequestContext();
  let principal = { id: 'fleet', credential: 'service-key', repositories: ['releases'] };
  const scheduler = new DownloadScheduler(downloadSchedulePolicy(1, policy));
  const gate = new AdmissionQueue(1, 4, 4, 1000, 1);
  const governor = new BandwidthGovernor({ bytesPerSecond: 0, perPrincipalBytesPerSecond: 0 }, [
    'fleet',
    'ann',
  ]);
  const sender = createContentSender({
    service: {
      async download() {
        return {
          upload: { descriptor: { size: bytes.length, sha256: 'b'.repeat(64), name: 'f.bin' } },
          async *read(range) {
            yield bytes.subarray(range?.start ?? 0, (range?.end ?? bytes.length - 1) + 1);
          },
        };
      },
    },
    admit: createDownloadAdmission({
      downloadGate: gate,
      downloadScheduler: scheduler,
      sessionThresholdBytes: 1024,
    }),
    downloadBandwidth: governor,
    diagnostics: { write() {} },
    principal: () => principal,
    signal: context.signal,
    pins: { acquire: async () => ({ check() {}, async release() {} }) },
  });
  registerHttpErrors(app, context);
  registerDownloadRoutes(
    app,
    { resolver: { resolve: async () => ({}) }, browse: { resolveAssetContent: async () => ({}) } },
    () => principal,
    sender,
  );
  t.after(async () => {
    scheduler.close();
    gate.close();
    governor.close();
    await app.close();
  });
  const get = (address, headers = {}, method = 'GET') =>
    app.inject({ method, url, remoteAddress: address, headers });
  return {
    get,
    scheduler,
    as(next) {
      principal = next;
    },
  };
}

test('a second client waits in the queue with its place and gets the file once the first is done', async (t) => {
  const s = await server(t, { interactiveReserve: 0 });
  // The first agent reads a range: its session holds the only place between ranges.
  const first = await s.get('10.0.0.1', { range: 'bytes=0-1023' });
  assert.equal(first.statusCode, 206);
  const queued = await s.get('10.0.0.2');
  assert.equal(queued.statusCode, 503);
  assert.equal(queued.json().code, 'busy');
  assert.equal(queued.json().reason, 'download_queued');
  assert.equal(queued.headers['arkvory-queue-position'], '1');
  assert.ok(Number(queued.headers['retry-after']) >= 2);
  assert.equal(queued.headers['etag'], undefined);
  assert.equal(queued.headers['content-disposition'], undefined);
  // HEAD and the next range of the admitted download pass without another admission.
  assert.equal((await s.get('10.0.0.2', {}, 'HEAD')).statusCode, 200);
  const rest = await s.get('10.0.0.1', { range: 'bytes=1024-' });
  assert.equal(rest.statusCode, 206);
  assert.equal(rest.rawPayload.length, bytes.length - 1024);
  // The last byte was delivered: the place is free and the waiting client takes it.
  s.scheduler.plan();
  const served = await s.get('10.0.0.2');
  assert.equal(served.statusCode, 200);
  assert.equal(served.rawPayload.length, bytes.length);
  s.scheduler.plan();
  const snapshot = s.scheduler.snapshot;
  assert.equal(snapshot.active, 0);
  assert.equal(snapshot.completed, 2);
  assert.equal(snapshot.waiting.release, 0);
});

test('a person is served from the reserve; a service cannot claim it with a header', async (t) => {
  const s = await server(t, {});
  s.scheduler.configure(downloadSchedulePolicy(2, { perPrincipalActive: 1 }));
  assert.equal((await s.get('10.0.0.1', { range: 'bytes=0-9' })).statusCode, 206);
  const claim = await s.get('10.0.0.2', { 'arkvory-priority': 'interactive' });
  assert.equal(claim.statusCode, 503);
  assert.equal(claim.json().reason, 'download_queued');
  s.as({ id: 'ann', credential: 'session', repositories: ['releases'] });
  s.scheduler.plan();
  assert.equal((await s.get('10.0.0.3')).statusCode, 200);
});

test('small objects and the shared strategy keep admission per request', async (t) => {
  const s = await server(t, { strategy: 'shared' });
  for (const address of ['10.0.0.1', '10.0.0.2', '10.0.0.3'])
    assert.equal((await s.get(address, { range: 'bytes=0-9' })).statusCode, 206);
  assert.equal(s.scheduler.snapshot.admitted, 0);
});
