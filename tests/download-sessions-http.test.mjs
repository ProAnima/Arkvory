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
const fleet = { id: 'fleet', credential: 'service-key', repositories: ['releases'] };
const id = (name) => name.padEnd(16, '0');

async function server(t, { policy = {}, holdMs = 0, slots = 1 } = {}) {
  const app = Fastify();
  const context = createRequestContext();
  let principal = fleet;
  const scheduler = new DownloadScheduler(
    downloadSchedulePolicy(slots, { sessionMinBytes: 1024, ...policy }),
    { limit: 4, timeoutMs: holdMs },
  );
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
    admit: createDownloadAdmission({ downloadGate: gate, downloadScheduler: scheduler }),
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
  const get = (address, headers = {}, method = 'GET', path = url) =>
    app.inject({ method, url: path, remoteAddress: address, headers });
  return {
    get,
    scheduler,
    as(next) {
      principal = next;
    },
  };
}

test('a client of the queue protocol is told its place at once and gets the file in its turn', async (t) => {
  const s = await server(t);
  const first = { 'arkvory-download-id': id('first') };
  const second = { 'arkvory-download-id': id('second') };
  const head = await s.get('10.0.0.1', { ...first, range: 'bytes=0-1023' });
  assert.equal(head.statusCode, 206);
  assert.equal(head.headers['arkvory-download-class'], 'release');
  const queued = await s.get('10.0.0.1', second);
  assert.equal(queued.statusCode, 503);
  assert.equal(queued.json().reason, 'download_queued');
  assert.equal(queued.headers['arkvory-download-class'], 'release');
  assert.ok(Number(queued.headers['retry-after']) >= 2);
  assert.equal(queued.headers['etag'], undefined);
  assert.equal(queued.headers['content-disposition'], undefined);
  // The next tick places it in the queue.
  s.scheduler.plan();
  assert.equal((await s.get('10.0.0.1', second)).headers['arkvory-queue-position'], '1');
  // HEAD and the further ranges of the admitted download take no new place.
  assert.equal((await s.get('10.0.0.1', second, 'HEAD')).statusCode, 200);
  const rest = await s.get('10.0.0.1', { ...first, range: 'bytes=1024-' });
  assert.equal(rest.statusCode, 206);
  assert.equal(rest.rawPayload.length, bytes.length - 1024);
  s.scheduler.plan();
  const served = await s.get('10.0.0.1', second);
  assert.equal(served.statusCode, 200);
  assert.equal(served.rawPayload.length, bytes.length);
  s.scheduler.plan();
  const snapshot = s.scheduler.snapshot;
  assert.equal(snapshot.active, 0);
  assert.equal(snapshot.completed, 2);
  assert.equal(snapshot.settings.sessions, 1);
});

test('a tool outside the protocol is held until its turn instead of failing on 503', async (t) => {
  const s = await server(t, { holdMs: 10_000 });
  assert.equal((await s.get('10.0.0.1', { range: 'bytes=0-1023' })).statusCode, 206);
  const held = s.get('10.0.0.2');
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(s.scheduler.snapshot.held, 1);
  await s.get('10.0.0.1', { range: 'bytes=1024-' });
  s.scheduler.plan();
  const answer = await held;
  assert.equal(answer.statusCode, 200);
  assert.equal(answer.rawPayload.length, bytes.length);
  assert.equal(s.scheduler.snapshot.held, 0);
  // Without a hold time it is answered at once, as a protocol client would be.
  const quick = await server(t);
  await quick.get('10.0.0.1', { range: 'bytes=0-9' });
  assert.equal((await quick.get('10.0.0.2')).statusCode, 503);
});

test('one address with two download ids is two downloads; the id and the class are checked', async (t) => {
  const s = await server(t);
  assert.equal(
    (await s.get('10.0.0.9', { 'arkvory-download-id': id('a'), range: 'bytes=0-9' })).statusCode,
    206,
  );
  assert.equal((await s.get('10.0.0.9', { 'arkvory-download-id': id('b') })).statusCode, 503);
  const wrongId = await s.get('10.0.0.9', { 'arkvory-download-id': 'short' });
  assert.equal(wrongId.statusCode, 400);
  const typo = await s.get('10.0.0.9', { 'arkvory-download-class': 'bulky' });
  assert.equal(typo.statusCode, 400);
  assert.match(typo.json().message, /Arkvory-Download-Class/);
});

test('a service cannot claim the people class; a person gets the reserve', async (t) => {
  const s = await server(t, { slots: 4, policy: { perPrincipalActive: 4 } });
  for (const name of ['a', 'b', 'c'])
    assert.equal(
      (await s.get('10.0.0.1', { 'arkvory-download-id': id(name), range: 'bytes=0-9' })).statusCode,
      206,
    );
  const claim = await s.get('10.0.0.1', {
    'arkvory-download-id': id('claim'),
    'arkvory-download-class': 'interactive',
  });
  assert.equal(claim.statusCode, 503);
  assert.equal(claim.headers['arkvory-download-class'], 'release');
  const lower = await s.get('10.0.0.1', {
    'arkvory-download-id': id('lower'),
    'arkvory-download-class': 'bulk',
  });
  assert.equal(lower.headers['arkvory-download-class'], 'bulk');
  s.as({ id: 'ann', credential: 'personal-token', repositories: ['releases'] });
  const person = await s.get('10.0.0.3');
  assert.equal(person.statusCode, 200, person.body);
  assert.equal(person.headers['arkvory-download-class'], 'interactive');
});

test('download links count apart from the person who issued them', async (t) => {
  const s = await server(t, { slots: 2, policy: { maxSessionsPerPrincipal: 1 } });
  assert.equal((await s.get('10.0.0.1', { range: 'bytes=0-9' })).statusCode, 206);
  s.as({ id: 'fleet', credential: 'transfer-token', repositories: ['releases'] });
  const link = await s.get('10.0.0.2', { range: 'bytes=0-9' }, 'GET', `${url}?token=dtl_one`);
  assert.equal(link.statusCode, 206, 'the issuer limit of one session does not bind the link');
});

test('small objects and the shared strategy keep admission per request', async (t) => {
  const s = await server(t, { policy: { strategy: 'shared' } });
  for (const address of ['10.0.0.1', '10.0.0.2', '10.0.0.3'])
    assert.equal((await s.get(address, { range: 'bytes=0-9' })).statusCode, 206);
  assert.equal(s.scheduler.snapshot.admitted, 0);
});
