import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { setup } from './fixture.mjs';

test('lost ownership requests one supervised shutdown and fresh startup recovers', async (t) => {
  let notifications = 0;
  let closed;
  const f = await setup(
    t,
    {},
    {
      onOwnershipLost: () => {
        notifications++;
        closed = f.app.close();
      },
    },
  );
  await f.listen();
  const killed = await f.catalog.pool
    .query(`SELECT pg_terminate_backend(pid) AS killed FROM pg_locks
    WHERE locktype='advisory' AND classid=18471 AND objid=3 AND objsubid=2 AND granted
    AND database=(SELECT oid FROM pg_database WHERE datname=current_database())`);
  assert.equal(killed.rows.length, 1);
  assert.equal(killed.rows[0].killed, true);
  for (let attempt = 0; attempt < 50 && notifications === 0; attempt++) await delay(100);
  assert.equal(notifications, 1, 'Fenced API must notify its process owner');
  await closed;
  assert.equal(f.app.server.listening, false);
  await f.restart();
  assert.equal((await f.app.inject({ url: '/health/ready', headers: f.headers })).statusCode, 200);
  await f.app.close();
  await delay(1200);
  assert.equal(notifications, 1, 'Intentional close must not trigger failure recovery');
});
