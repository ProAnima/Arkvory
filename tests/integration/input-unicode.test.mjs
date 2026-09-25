import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setup, base, descriptor } from './fixture.mjs';

test('invalid descriptor text is rejected before reserving quota or consuming its idempotency key', async (t) => {
  const bytes = Buffer.from('data');
  const f = await setup(t, { capacityBytes: bytes.length });
  const headers = { ...f.headers, 'idempotency-key': randomUUID() };
  const valid = {
    ...descriptor(bytes),
    name: 'build-🚀.upack',
    labels: ['linux', 'release'],
    metadata: { notes: 'Русский 🚀\n\t\u0001' },
  };
  for (const character of ['\u0000', '\uD800', '\uDFFF']) {
    for (const patch of [
      { name: `build-${character}.upack` },
      { metadata: { notes: `before${character}after` } },
    ]) {
      const rejected = await f.app.inject({
        method: 'POST',
        url: `${base}/uploads`,
        headers,
        payload: { ...valid, ...patch },
      });
      assert.equal(rejected.statusCode, 400, rejected.body);
      assert.equal(rejected.json().code, 'invalid_input');
    }
  }
  assert.equal(
    (await f.catalog.pool.query('SELECT count(*) FROM depot_uploads')).rows[0].count,
    '0',
  );
  const created = await f.app.inject({
    method: 'POST',
    url: `${base}/uploads`,
    headers,
    payload: valid,
  });
  assert.equal(created.statusCode, 201, created.body);
  assert.deepEqual(created.json().descriptor, valid);
  const repeated = await f.app.inject({
    method: 'POST',
    url: `${base}/uploads`,
    headers,
    payload: valid,
  });
  assert.equal(repeated.statusCode, 201, repeated.body);
  assert.equal(repeated.json().id, created.json().id);
  const totals = await f.catalog.pool.query(
    'SELECT count(*), sum(size)::text AS bytes FROM depot_uploads',
  );
  assert.deepEqual(totals.rows[0], { count: '1', bytes: String(bytes.length) });

  const id = created.json().id;
  const published = await f.app.inject({
    method: 'PUT',
    url: `${base}/uploads/${id}/content`,
    headers: { ...f.headers, 'content-type': 'application/octet-stream' },
    payload: bytes,
  });
  assert.equal(published.statusCode, 200, published.body);
  const url = `${base}/artifacts/${id}/annotations`;
  for (const notes of ['\u0000', '\uD800', '\uDFFF']) {
    const rejected = await f.app.inject({
      method: 'PUT',
      url,
      headers: f.headers,
      payload: { expectedRevision: 0, value: { labels: [], collections: [], metadata: { notes } } },
    });
    assert.equal(rejected.statusCode, 400, rejected.body);
    assert.equal(rejected.json().code, 'invalid_input');
  }
  const saved = await f.app.inject({
    method: 'PUT',
    url,
    headers: f.headers,
    payload: {
      expectedRevision: 0,
      value: { labels: [], collections: [], metadata: valid.metadata },
    },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().revision, 1);
  assert.deepEqual(saved.json().metadata, valid.metadata);
});
