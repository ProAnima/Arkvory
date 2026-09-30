import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { setup, base } from './fixture.mjs';

const GiB = 1024 ** 3;
const MiB = 1024 ** 2;
const describe = (size) => ({
  name: 'large.bin',
  size: String(size),
  sha256: 'a'.repeat(64),
  labels: [],
  metadata: {},
});
const create = (f, size) =>
  f.app.inject({
    method: 'POST',
    url: `${base}/uploads`,
    headers: { ...f.headers, 'idempotency-key': randomUUID() },
    payload: describe(size),
  });
const putPart = (f, id, index, bytes) =>
  f.app.inject({
    method: 'PUT',
    url: `${base}/uploads/${id}/parts/${String(index)}`,
    headers: {
      ...f.headers,
      'content-type': 'application/octet-stream',
      'x-content-sha256': createHash('sha256').update(bytes).digest('hex'),
    },
    payload: bytes,
  });

test('objects beyond 8 MiB x 10000 parts get a larger stored part size', async (t) => {
  const f = await setup(t, { capacityBytes: 400 * GiB });
  const capabilities = await f.app.inject({ url: '/api/v1/capabilities', headers: f.headers });
  assert.equal(capabilities.statusCode, 200, capabilities.body);
  assert.deepEqual(
    [capabilities.json().limits.partBytes, capabilities.json().limits.maxParts],
    [8 * MiB, 10000],
  );
  const size = 100 * GiB + 5;
  const created = await create(f, size);
  assert.equal(created.statusCode, 201, created.body);
  const id = created.json().id;
  const layout = await f.app.inject({ url: `${base}/uploads/${id}/parts`, headers: f.headers });
  assert.deepEqual(layout.json(), { partBytes: 16 * MiB, items: [] });
  const bytes = Buffer.alloc(16 * MiB, 7);
  assert.notEqual((await putPart(f, id, 0, bytes.subarray(0, 8 * MiB))).statusCode, 204);
  const stored = await putPart(f, id, 0, bytes);
  assert.equal(stored.statusCode, 204, stored.body);
  const listed = await f.app.inject({ url: `${base}/uploads/${id}/parts`, headers: f.headers });
  assert.deepEqual(listed.json().items, [
    { index: 0, size: 16 * MiB, sha256: createHash('sha256').update(bytes).digest('hex') },
  ]);
  const last = Math.ceil(size / (16 * MiB)) - 1;
  assert.equal((await putPart(f, id, last + 1, Buffer.alloc(5))).statusCode, 400);
  // Existing sessions keep their stored layout even if the default would differ.
  const small = await create(f, 20 * MiB);
  const smallLayout = await f.app.inject({
    url: `${base}/uploads/${small.json().id}/parts`,
    headers: f.headers,
  });
  assert.equal(smallLayout.json().partBytes, 8 * MiB);
});

test('an operator ceiling rejects larger objects before any bytes are sent', async (t) => {
  const f = await setup(t, { maxObjectBytes: 4096 });
  const capabilities = await f.app.inject({ url: '/api/v1/capabilities', headers: f.headers });
  assert.equal(capabilities.json().limits.maxObjectBytes, '4096');
  assert.equal((await create(f, 4096)).statusCode, 201);
  const rejected = await create(f, 4097);
  assert.equal(rejected.statusCode, 400, rejected.body);
  assert.equal(rejected.json().code, 'invalid_input');
});
