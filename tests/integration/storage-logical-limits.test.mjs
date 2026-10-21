import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PostgresCatalog, migrate } from '@proanima/arkvory-infrastructure';
import { emptySchema } from './schema-fingerprint.mjs';

function upload(size = 6, repository = 'releases') {
  return {
    id: randomUUID(),
    repository,
    owner: 'test',
    key: randomUUID(),
    descriptor: { name: 'file.bin', size, sha256: '0'.repeat(64), labels: [], metadata: {} },
    createdAt: '2026-10-21T00:00:00Z',
    storageBackend: 'limited.data',
    partBytes: 8388608,
  };
}

test('backend limit reserves across connections/repositories and preserves admitted uploads', async (t) => {
  const pool = await emptySchema(t);
  await migrate(pool);
  let limit = '10';
  const catalogs = Array.from(
    { length: 2 },
    () => new PostgresCatalog(pool.options.connectionString, 10000, 2, 5, () => limit),
  );
  t.after(async () => {
    for (const catalog of catalogs) await catalog.close();
  });
  const inputs = Array.from({ length: 8 }, (_, i) => upload(6, `repo-${i}`));
  const rows = await Promise.all(inputs.map((input, i) => catalogs[i % 2].create(input)));
  const admitted = rows.filter((r) => r.storageBackend === 'limited.data');
  assert.equal(admitted.length, 1, 'sum of pending reservations must not exceed ten');
  const used = async () =>
    (await pool.query("SELECT bytes::text FROM arkvory_backend_bytes WHERE backend='limited.data'"))
      .rows[0].bytes;
  assert.equal(await used(), '6');
  limit = '0';
  const original = inputs.find((i) => i.id === admitted[0].id);
  assert.deepEqual(await catalogs[1].create(original), admitted[0], 'replay keeps its reservation');
  await catalogs[0].exclusive(original.id, (m) => m.publish(original.repository));
  assert.equal(await used(), '6', 'publication does not charge twice');
  assert.equal((await catalogs[0].create(upload(1))).storageBackend, 'default');
  await catalogs[0].exclusive(original.id, (m) => m.cancel(original.repository));
  assert.equal(await used(), '6', 'cancel does not free bytes before cleanup');
  await pool.query('UPDATE arkvory_uploads SET reclaimed=true WHERE id=$1', [original.id]);
  assert.equal(await used(), '0');
  limit = '6';
  assert.equal((await catalogs[0].create(upload())).storageBackend, 'limited.data');
  limit = '18446744073709551615';
  assert.equal((await catalogs[0].create(upload())).storageBackend, 'limited.data');
  for (const invalid of ['18446744073709551616', '01', '-1', '1.5', 10]) {
    limit = invalid;
    await assert.rejects(catalogs[0].create(upload()), /Invalid storage logical byte limit/);
  }
  assert.equal(await used(), '12', 'rejected requests do not mutate accounting');
});

test('migration backfills retained backend bytes and tracks moves/deletes exactly', async (t) => {
  const pool = await emptySchema(t);
  await migrate(pool, { upTo: 50 });
  const catalog = new PostgresCatalog(pool.options.connectionString, 10000, 2);
  t.after(() => catalog.close());
  const a = await catalog.create(upload(7));
  const b = await catalog.create(upload(5));
  await pool.query('UPDATE arkvory_uploads SET reclaimed=true WHERE id=$1', [b.id]);
  await migrate(pool);
  await migrate(pool);
  const counts = async () =>
    (await pool.query('SELECT backend,bytes::text FROM arkvory_backend_bytes ORDER BY backend'))
      .rows;
  assert.deepEqual(await counts(), [{ backend: 'limited.data', bytes: '7' }]);
  await pool.query("UPDATE arkvory_uploads SET storage_backend='default' WHERE id=$1", [a.id]);
  assert.deepEqual(await counts(), [
    { backend: 'default', bytes: '7' },
    { backend: 'limited.data', bytes: '0' },
  ]);
  await pool.query('DELETE FROM arkvory_uploads WHERE id=$1', [a.id]);
  assert.deepEqual(await counts(), [
    { backend: 'default', bytes: '0' },
    { backend: 'limited.data', bytes: '0' },
  ]);
});
