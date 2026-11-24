import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DerivedCacheSession } from '../packages/infrastructure/dist/derived-cache-session.js';
import { httpLicenceHub } from '../packages/infrastructure/dist/licence-hub.js';

// A short outage of a dependency must slow a service down, not disable it until a restart.

test('a cache owner session connects again after the pool refused a connection', async () => {
  let attempts = 0;
  const pool = {
    connect: async () => {
      attempts++;
      throw new Error('timeout exceeded when trying to connect');
    },
  };
  const session = new DerivedCacheSession(pool, randomUUID());
  await assert.rejects(session.get(), /timeout exceeded/);
  assert.equal(session.started, false, 'no owner exists that a shutdown would have to quiesce');
  await assert.rejects(session.get(), /timeout exceeded/);
  assert.equal(attempts, 2, 'the second call asked the pool again');
  await session.close();
  await assert.rejects(session.get(), { code: 'unavailable' });
  assert.equal(attempts, 2, 'a closed session never connects');
});

test('a hub that could not be connected to did not receive the refresh', async () => {
  const body = { activationId: 'act_0', activationSecret: 's', nonce: 'n', seq: 1 };
  const failing = (code) => async () => {
    throw new TypeError('fetch failed', { cause: Object.assign(new Error(code), { code }) });
  };
  const hub = (code) =>
    httpLicenceHub({ url: 'https://hub.invalid', project: 'arkvory' }, failing(code));
  // Before a connection exists nothing was written: the secret is still current, retry later.
  for (const code of ['UND_ERR_CONNECT_TIMEOUT', 'ECONNREFUSED', 'ENOTFOUND'])
    assert.deepEqual(await hub(code).refresh(body), {
      kind: 'failed',
      failure: 'unreachable',
      sent: false,
      retryAfterMs: null,
    });
  // A connection that broke may have carried the request: the answer is unknown.
  for (const code of ['ECONNRESET', 'UND_ERR_SOCKET'])
    assert.equal((await hub(code).refresh(body)).sent, true, code);
});
