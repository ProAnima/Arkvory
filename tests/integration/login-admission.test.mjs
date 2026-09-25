import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { setup } from './fixture.mjs';

test('unfinished public login bodies cannot exhaust authenticated request capacity', async (t) => {
  const f = await setup(t);
  const address = await f.listen();
  const sockets = [];
  const rejected = [];
  const errors = [];
  t.after(() => {
    for (const socket of sockets) socket.destroy();
  });
  // This used to occupy all 128 common slots before the password handler ran.
  for (let index = 0; index < 128; index++) {
    const outgoing = request(
      address + '/api/v1/auth/login',
      {
        method: 'POST',
        agent: false,
        headers: { 'content-type': 'application/json', 'content-length': '100' },
      },
      (response) => {
        response.resume();
        response.once('end', () => {
          rejected.push({ status: response.statusCode, connection: response.headers.connection });
        });
      },
    );
    outgoing.on('error', (error) => errors.push(error));
    sockets.push(outgoing);
    outgoing.write('{');
  }
  const deadline = Date.now() + 5000;
  while (rejected.length < 112 && Date.now() < deadline) await delay(10);
  assert.equal(errors.length, 0);
  assert.equal(rejected.length, 112, 'Public login admission must reject excess unread bodies');
  assert(rejected.every((item) => item.status === 503 && item.connection === 'close'));
  const ready = await f.app.inject({ url: '/health/ready', headers: f.headers });
  assert.equal(ready.statusCode, 200, ready.body);
  const identity = await f.app.inject({ url: '/api/v1/auth/me', headers: f.headers });
  assert.equal(identity.statusCode, 200, identity.body);
  for (const socket of sockets) socket.destroy();
  const recoveryDeadline = Date.now() + 3000;
  let recovered;
  do {
    recovered = await f.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: {} });
    if (recovered.statusCode !== 503) break;
    await delay(10);
  } while (Date.now() < recoveryDeadline);
  assert.equal(recovered.statusCode, 400, recovered.body);
});
