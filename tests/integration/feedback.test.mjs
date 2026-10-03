import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { setup } from './fixture.mjs';

/** The hub's feedback endpoint on loopback: records each form, answers as configured. */
async function fakeHub(t) {
  const received = [];
  const hub = { status: 202, body: { id: 'hub-1' }, headers: {}, received };
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const form = await new Response(Buffer.concat(chunks), {
      headers: { 'content-type': request.headers['content-type'] },
    }).formData();
    received.push({ path: request.url, form });
    response.writeHead(hub.status, { 'content-type': 'application/json', ...hub.headers });
    response.end(JSON.stringify(hub.body));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  hub.url = `http://127.0.0.1:${String(server.address().port)}`;
  return hub;
}
const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64');
const body = (change = {}) => ({
  message: 'Downloads stall behind the proxy',
  email: null,
  lang: 'ru',
  screen: '390x844',
  screenshots: [{ name: 'proxy.png', type: 'image/png', data: png }],
  clientLog: 'GET /api/v1/repositories 503',
  serverLog: false,
  ...change,
});

test('feedback goes to the hub; only an administrator attaches the server log', async (t) => {
  const hub = await fakeHub(t);
  const f = await setup(t, { hub: { url: hub.url, project: 'arkvory' } });
  const send = (headers, payload) =>
    f.app.inject({ method: 'POST', url: '/api/v1/feedback', headers, payload });
  // A failed request first, so the server log has a record to attach.
  await f.app.inject({
    url: '/api/v1/repositories/releases/artifacts/missing',
    headers: f.headers,
  });

  const refused = await send(f.readerHeaders, body({ serverLog: true }));
  assert.equal(refused.statusCode, 403, refused.body);
  assert.equal(refused.json().reason, 'administrator_required');
  assert.equal(hub.received.length, 0, 'nothing reaches the hub before the check');

  const plain = await send(f.readerHeaders, body());
  assert.equal(plain.statusCode, 202, plain.body);
  assert.deepEqual(plain.json(), { id: 'hub-1' });
  const first = hub.received[0];
  assert.equal(first.path, '/v1/arkvory/feedback');
  assert.equal(first.form.get('message'), 'Downloads stall behind the proxy');
  assert.equal(JSON.parse(first.form.get('meta')).lang, 'ru');
  assert.equal(first.form.getAll('screenshot').length, 1);
  assert.deepEqual(
    first.form.getAll('log').map((file) => file.name),
    ['arkvory-console.log'],
  );

  const full = await send(f.headers, body({ serverLog: true, screenshots: [] }));
  assert.equal(full.statusCode, 202, full.body);
  const logs = hub.received[1].form.getAll('log');
  assert.deepEqual(
    logs.map((file) => file.name),
    ['arkvory-console.log', 'arkvory-api.log', 'arkvory-system.json'],
  );
  assert.match(
    await logs[1].text(),
    /"route":"\/api\/v1\/repositories\/:repository\/artifacts\/:id"/,
  );
  const system = JSON.parse(await logs[2].text());
  assert.equal(typeof system.schema, 'number');
  assert.doesNotMatch(await logs[2].text(), /postgres|test-/, 'no addresses or credentials');

  const preview = await f.app.inject({ url: '/api/v1/feedback/attachments', headers: f.headers });
  assert.equal(preview.statusCode, 200, preview.body);
  assert.match(preview.json().system, /"schema"/);
  const hidden = await f.app.inject({
    url: '/api/v1/feedback/attachments',
    headers: f.readerHeaders,
  });
  assert.equal(hidden.statusCode, 403);

  for (const invalid of [body({ message: '' }), { ...body(), extra: 1 }]) {
    const answer = await send(f.headers, invalid);
    assert.equal(answer.statusCode, 400, answer.body);
  }
  const anonymous = await f.app.inject({
    method: 'POST',
    url: '/api/v1/feedback',
    payload: body(),
  });
  assert.equal(anonymous.statusCode, 401);
});

test('a rate-limited hub is answered with Retry-After', async (t) => {
  const hub = await fakeHub(t);
  const f = await setup(t, { hub: { url: hub.url, project: 'arkvory' } });
  hub.status = 429;
  hub.body = { error: { code: 'feedback.rate_limited' } };
  hub.headers = { 'retry-after': '300' };
  const limited = await f.app.inject({
    method: 'POST',
    url: '/api/v1/feedback',
    headers: f.headers,
    payload: body(),
  });
  assert.equal(limited.statusCode, 429, limited.body);
  assert.equal(limited.json().reason, 'feedback_attempts');
  assert.equal(limited.headers['retry-after'], '300');
});

// One API per test: the writer lock is database-wide.
test('feedback turned off answers feedback_disabled', async (t) => {
  const off = await setup(t);
  const disabled = await off.app.inject({
    method: 'POST',
    url: '/api/v1/feedback',
    headers: off.headers,
    payload: body(),
  });
  assert.equal(disabled.statusCode, 503, disabled.body);
  assert.equal(disabled.json().reason, 'feedback_disabled');
});

test('a hub that cannot be reached answers hub_unreachable', async (t) => {
  const gone = await setup(t, { hub: { url: 'http://127.0.0.1:9', project: 'arkvory' } });
  const unreachable = await gone.app.inject({
    method: 'POST',
    url: '/api/v1/feedback',
    headers: gone.headers,
    payload: body(),
  });
  assert.equal(unreachable.statusCode, 503, unreachable.body);
  assert.equal(unreachable.json().reason, 'hub_unreachable');
});
