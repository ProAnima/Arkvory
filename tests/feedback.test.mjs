import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { base64Bytes, feedbackLimits, readFeedbackRequest } from '@proanima/arkvory-contracts';
import { FeedbackForwarder } from '../apps/api/dist/feedback.js';
import { RecentLog } from '../apps/api/dist/recent-log.js';
import { redact } from '../apps/web/dist/client-log.js';

const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const request = (change = {}) => ({
  message: '  The upload stops at 99 %  ',
  email: 'ops@example.com',
  lang: 'en',
  screen: '1440x900',
  screenshots: [{ name: 'shot.png', type: 'image/png', data: png.toString('base64') }],
  clientLog: 'console line',
  serverLog: false,
  ...change,
});

test('a feedback request is checked against the hub limits before anything is sent', () => {
  const parsed = readFeedbackRequest(request());
  assert.equal(parsed.message, 'The upload stops at 99 %');
  assert.equal(base64Bytes(png.toString('base64')), png.length);
  for (const bad of [
    request({ message: '   ' }),
    request({ message: 'x'.repeat(feedbackLimits.messageChars + 1) }),
    request({ email: 'not an address' }),
    request({ lang: 'de' }),
    request({ screen: '1440 x 900' }),
    request({ screenshots: Array(7).fill(request().screenshots[0]) }),
    request({ screenshots: [{ name: '../x.png', type: 'image/png', data: 'AAAA' }] }),
    request({ screenshots: [{ name: 'x.svg', type: 'image/svg+xml', data: 'AAAA' }] }),
    request({ screenshots: [{ name: 'x.png', type: 'image/png', data: 'not base64!' }] }),
    request({ clientLog: 'x'.repeat(feedbackLimits.logBytes + 1) }),
    request({ serverLog: 'yes' }),
    { ...request(), extra: true },
  ])
    assert.throws(() => readFeedbackRequest(bad), undefined, JSON.stringify(bad).slice(0, 80));
  // The server's own attachments are reserved within the total.
  const big = 'A'.repeat(((6 * 1024 * 1024) / 3) * 4);
  const shots = Array(2).fill({ name: 'big.png', type: 'image/png', data: big });
  readFeedbackRequest(request({ screenshots: shots }));
  assert.throws(
    () => readFeedbackRequest(request({ screenshots: shots, serverLog: true })),
    /too large/,
  );
});

function hub(status = 202, body = { id: 'f-1' }, headers = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, form: init.body, redirect: init.redirect });
    return new Response(JSON.stringify(body), { status, headers });
  };
  return { calls, fetch };
}
const sources = (fake, change = {}) => ({
  hub: { url: 'https://hub.example', project: 'arkvory' },
  version: '1.2.3',
  log: { text: () => '{"code":"api.listening"}\n' },
  system: async () => ({ arkvory: '1.2.3' }),
  fetch: fake.fetch,
  ...change,
});

test('feedback reaches the hub as its multipart form, server files only on request', async () => {
  const fake = hub();
  const forwarder = new FeedbackForwarder(sources(fake));
  assert.deepEqual(await forwarder.send(readFeedbackRequest(request())), { id: 'f-1' });
  const [call] = fake.calls;
  assert.equal(call.url, 'https://hub.example/v1/arkvory/feedback');
  assert.equal(call.redirect, 'error');
  assert.equal(call.form.get('message'), 'The upload stops at 99 %');
  assert.equal(call.form.get('email'), 'ops@example.com');
  const meta = JSON.parse(call.form.get('meta'));
  assert.equal(meta.version, '1.2.3');
  assert.equal(meta.mode, 'server');
  assert.equal(meta.screen, '1440x900');
  const shot = call.form.get('screenshot');
  assert.equal(shot.name, 'shot.png');
  assert.deepEqual(Buffer.from(await shot.arrayBuffer()), png);
  assert.deepEqual(
    call.form.getAll('log').map((file) => file.name),
    ['arkvory-console.log'],
  );
  await forwarder.send(readFeedbackRequest(request({ serverLog: true, clientLog: null })));
  const logs = fake.calls[1].form.getAll('log');
  assert.deepEqual(
    logs.map((file) => file.name),
    ['arkvory-api.log', 'arkvory-system.json'],
  );
  assert.deepEqual(JSON.parse(await logs[1].text()), { arkvory: '1.2.3' });
});

test('hub refusals become this API error contract', async () => {
  const send = (fake, change) =>
    new FeedbackForwarder(sources(fake, change)).send(readFeedbackRequest(request()));
  await assert.rejects(send(hub(), { hub: null }), {
    code: 'unavailable',
    reason: 'feedback_disabled',
  });
  await assert.rejects(
    send(hub(429, { error: { code: 'feedback.rate_limited' } }, { 'retry-after': '120' })),
    { code: 'rate_limited', reason: 'feedback_attempts', retryAfterSeconds: 120 },
  );
  await assert.rejects(send(hub(403, { error: { code: 'feedback.disabled' } })), {
    reason: 'feedback_disabled',
  });
  await assert.rejects(send(hub(413, { error: { code: 'feedback.too_large' } })), {
    code: 'invalid_input',
  });
  await assert.rejects(send(hub(502, {})), { reason: 'hub_unreachable' });
  const offline = {
    fetch: async () => {
      throw new TypeError('fetch failed');
    },
  };
  await assert.rejects(send(offline), { code: 'unavailable', reason: 'hub_unreachable' });
});

test('the recent log passes everything through and keeps a bounded tail', async () => {
  const target = new PassThrough();
  const out = [];
  target.on('data', (chunk) => out.push(chunk.toString()));
  const log = new RecentLog(target);
  for (let index = 0; index < 4000; index++)
    log.write(`{"index":${String(index)},"pad":"${'x'.repeat(500)}"}\n`);
  await new Promise((resolve) => log.end(resolve));
  assert.equal(out.join('').split('\n').filter(Boolean).length, 4000, 'stdout keeps every line');
  const kept = log.text().trim().split('\n');
  assert.ok(Buffer.byteLength(log.text()) <= 1536 * 1024);
  assert.ok(kept.length < 4000);
  assert.match(kept.at(-1), /"index":3999/);
});

test('the console log masks credentials but keeps request ids', () => {
  const id = '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b';
  const text = redact(
    `Authorization: Bearer abc.def-123 GET /x?token=secret1 request ${id} key ${'k'.repeat(40)}`,
  );
  assert.doesNotMatch(text, /abc\.def-123|secret1|kkkkk/);
  assert.match(text, new RegExp(id));
  // Paths are what support needs; they are the user's own data shown before sending.
  const path =
    '/api/v1/repositories/releases/artifacts/6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b/content';
  assert.equal(redact(`GET ${path} 404`), `GET ${path} 404`);
});
