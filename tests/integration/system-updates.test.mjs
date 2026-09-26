import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setup } from './fixture.mjs';
import { removeTestDirectory } from '../helpers.mjs';
import { initialUpdateSnapshot } from '../../apps/deploy/dist/update-monitor.js';
import { DepotClient } from '@proanima/depot-sdk';

test('system update API protects the host mailbox and round-trips through SDK', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'depot-updates-'));
  t.after(() => removeTestDirectory(directory));
  await mkdir(join(directory, 'status'));
  await mkdir(join(directory, 'inbox'));
  const snapshot = initialUpdateSnapshot(
    { automatic: false, pin: null, current: { version: '1.0.0', schema: 15 } },
    new Date().toISOString(),
  );
  await writeFile(join(directory, 'status/snapshot.json'), JSON.stringify(snapshot));
  const f = await setup(t, { updateControlDirectory: directory });
  const url = '/api/v1/system/updates';
  assert.equal((await f.app.inject({ url, headers: f.readerHeaders })).statusCode, 403);
  assert.equal((await f.app.inject({ url })).statusCode, 401);
  const client = new DepotClient(await f.listen(), () => f.headers.authorization.slice(7));
  assert.equal((await client.updates.status()).snapshot.currentVersion, '1.0.0');
  const request = { id: randomUUID(), kind: 'check', expectedRevision: 0 };
  assert.deepEqual(await client.updates.request(request), { id: request.id });
  assert.deepEqual(await client.updates.request(request), { id: request.id });
  assert.deepEqual(
    JSON.parse(await readFile(join(directory, 'inbox/request.json'), 'utf8')),
    request,
  );
  await assert.rejects(client.updates.request({ ...request, id: randomUUID() }), { status: 503 });
  assert.equal(
    (
      await f.app.inject({
        url: url + '/requests',
        method: 'POST',
        headers: f.readerHeaders,
        payload: request,
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await f.app.inject({
        url: url + '/requests',
        method: 'POST',
        headers: f.headers,
        payload: { ...request, command: 'sh' },
      })
    ).statusCode,
    400,
  );
  await unlink(join(directory, 'inbox/request.json'));
  await assert.rejects(
    client.updates.request({ ...request, id: randomUUID(), expectedRevision: 5 }),
    { status: 409 },
  );
  snapshot.heartbeatAt = '2020-01-01T00:00:00.000Z';
  await writeFile(join(directory, 'status/snapshot.json'), JSON.stringify(snapshot));
  await assert.rejects(client.updates.request({ ...request, id: randomUUID() }), { status: 503 });
});
test('an unmanaged installation reports no updater without exposing local configuration', async (t) => {
  const f = await setup(t);
  const response = await f.app.inject({ url: '/api/v1/system/updates', headers: f.headers });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { snapshot: null, pending: null });
});
