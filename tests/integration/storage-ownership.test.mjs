import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { StorageOwnership } from '../../packages/infrastructure/dist/storage-ownership.js';

// The liveness probe and the owner's statements share one connection, and pg sends the queries
// of a client in order. These cases need a real server: the wait happens in PostgreSQL.
async function owned(t) {
  const pool = new pg.Pool({ connectionString: process.env.ARKVORY_TEST_DATABASE_URL, max: 2 });
  pool.on('error', () => undefined);
  const client = await pool.connect();
  const ownership = new StorageOwnership(client);
  // The owner gives its connection back first; the pool waits for every client it lent.
  t.after(async () => {
    await ownership.close();
    await pool.end();
  });
  await ownership.startConnection();
  return { client, ownership };
}

test('a statement of the owner that waits longer than a probe does not cost the session', async (t) => {
  const { client, ownership } = await owned(t);
  // Longer than the two seconds a probe may take and than the pause between two probes.
  const result = await ownership.during(() => client.query('SELECT pg_sleep(4.5), 1 AS done'));
  assert.equal(result.rows[0].done, 1);
  assert.equal(ownership.active, true);
  // Probing goes on afterwards: the window is renewed well past the one that covered the wait.
  await new Promise((resolve) => setTimeout(resolve, 5000));
  assert.equal(ownership.active, true);
  assert.equal((await client.query('SELECT 2 AS still')).rows[0].still, 2);
});

test('a session that stays silent past its validity window is still given up', async (t) => {
  const { client, ownership } = await owned(t);
  // The answer never matters: the connection is destroyed under the statement.
  void ownership.during(() => client.query('SELECT pg_sleep(11)')).catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 9000));
  assert.equal(ownership.active, false, 'no probe was confirmed for eight seconds');
});
