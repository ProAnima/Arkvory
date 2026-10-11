import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { migrate } from '@proanima/arkvory-infrastructure';
import { emptySchema } from './schema-fingerprint.mjs';

/*
 * Retained bytes per repository and status (ADR 0073): the trigger-kept table must always equal
 * a fresh sum over the uploads, whatever changes the rows, including from parallel transactions.
 */

const counted = async (pool) =>
  (
    await pool.query(
      `SELECT repository, status, bytes::text FROM arkvory_upload_bytes
       WHERE bytes <> 0 ORDER BY repository, status`,
    )
  ).rows;

const recounted = async (pool) =>
  (
    await pool.query(
      `SELECT repository, status, sum(size)::text AS bytes FROM arkvory_uploads
       WHERE NOT reclaimed GROUP BY repository, status ORDER BY repository, status`,
    )
  ).rows;

const insert = (pool, repository, size, id = randomUUID()) =>
  pool
    .query(
      `INSERT INTO arkvory_uploads(id,repository,owner,idempotency_key,descriptor,size,created_at)
       VALUES($1::uuid,$2,'writer',$1::text,'{}',$3,now())`,
      [id, repository, size],
    )
    .then(() => id);

test('migration 35 counts the uploads that exist before it', async (t) => {
  const pool = await emptySchema(t);
  await migrate(pool, { upTo: 34 });
  await insert(pool, 'releases', 100);
  await insert(pool, 'releases', 50);
  const reclaimed = await insert(pool, 'builds', 70);
  await pool.query("UPDATE arkvory_uploads SET status='cancelled', reclaimed=true WHERE id=$1", [
    reclaimed,
  ]);
  await insert(pool, 'builds', 7);
  await migrate(pool);
  assert.deepEqual(await counted(pool), [
    { repository: 'builds', status: 'pending', bytes: '7' },
    { repository: 'releases', status: 'pending', bytes: '150' },
  ]);
});

test('every kind of upload change keeps the counts equal to a fresh sum', async (t) => {
  const pool = await emptySchema(t);
  await migrate(pool);
  const check = async (step) => {
    assert.deepEqual(await counted(pool), await recounted(pool), step);
  };
  const a = await insert(pool, 'releases', 1000);
  const b = await insert(pool, 'releases', 2000);
  const c = await insert(pool, 'builds', 300);
  await check('inserts');
  await pool.query("UPDATE arkvory_uploads SET status='available' WHERE id=$1", [a]);
  await check('publish');
  await pool.query("UPDATE arkvory_uploads SET status='cancelled' WHERE id=$1", [b]);
  await check('cancel');
  await pool.query('UPDATE arkvory_uploads SET reclaimed=true WHERE id=$1', [b]);
  await check('reclaim');
  await pool.query("UPDATE arkvory_uploads SET status='pending', reclaimed=false WHERE id=$1", [b]);
  await check('a mirror takes a reclaimed row back');
  await pool.query('UPDATE arkvory_uploads SET size=size+5 WHERE id=$1', [c]);
  await check('size change');
  await pool.query("UPDATE arkvory_uploads SET repository='archive' WHERE id=$1", [c]);
  await check('repository change');
  // Many rows in one statement, as restore normalization does.
  await pool.query(
    "UPDATE arkvory_uploads SET status='cancelled', reclaimed=(status<>'available')",
  );
  await check('bulk update');
  await pool.query('DELETE FROM arkvory_uploads WHERE id=$1', [a]);
  await check('delete');
  assert.deepEqual(await counted(pool), []);
});

test('parallel transactions lose no bytes', async (t) => {
  const pool = await emptySchema(t);
  await migrate(pool);
  const ids = await Promise.all(
    Array.from({ length: 40 }, (_, index) => insert(pool, index % 2 ? 'releases' : 'builds', 11)),
  );
  // Publications and cancellations of different rows of one repository at the same time.
  await Promise.all(
    ids.map((id, index) =>
      pool.query(`UPDATE arkvory_uploads SET status=$2 WHERE id=$1`, [
        id,
        index % 3 ? 'available' : 'cancelled',
      ]),
    ),
  );
  assert.deepEqual(await counted(pool), await recounted(pool));
  const total = (await pool.query('SELECT sum(bytes)::text AS total FROM arkvory_upload_bytes'))
    .rows[0].total;
  assert.equal(total, String(40 * 11));
});
