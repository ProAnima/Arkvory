import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FreshReads,
  parseDecision,
  replicaAnswer,
  volumeState,
} from '../apps/deploy/dist/replica-state.js';
import { parseCluster, replicaServer } from '../apps/deploy/dist/replica-service.js';

// `drbdsetup status --json` of DRBD 9, reduced to the fields the helper reads.
const peer = (state, disk, replication = 'Established', client = false) => ({
  'peer-node-id': 1,
  name: 'node-b',
  'connection-state': state,
  peer_devices: [
    { volume: 0, 'replication-state': replication, 'peer-disk-state': disk, 'peer-client': client },
  ],
});
const status = (disk, ...connections) => [
  { name: 'arkvory', role: 'Primary', devices: [{ volume: 0, 'disk-state': disk }], connections },
];

test('complete copies are the local disk and every connected, replicating, up-to-date peer', () => {
  const witness = peer('Connected', 'Diskless', 'Established', true);
  // ha-2 healthy: both disks, the witness does not count.
  assert.deepEqual(
    volumeState(status('UpToDate', peer('Connected', 'UpToDate'), witness), 'arkvory'),
    {
      role: 'Primary',
      copies: 2,
    },
  );
  // The peer is gone (or IO is frozen while DRBD fences it): one copy.
  assert.equal(
    volumeState(status('UpToDate', peer('Connecting', 'DUnknown'), witness), 'arkvory').copies,
    1,
  );
  // The peer came back and resynchronizes: it misses writes until it is UpToDate.
  assert.equal(
    volumeState(status('UpToDate', peer('Connected', 'Inconsistent', 'SyncSource')), 'arkvory')
      .copies,
    1,
  );
  // ha-3 healthy, and with one peer lost.
  const third = { ...peer('Connected', 'UpToDate'), 'peer-node-id': 2, name: 'node-c' };
  assert.equal(
    volumeState(status('UpToDate', peer('Connected', 'UpToDate'), third), 'arkvory').copies,
    3,
  );
  assert.equal(
    volumeState(status('UpToDate', peer('Connecting', 'DUnknown'), third), 'arkvory').copies,
    2,
  );
  // This node's own disk failed (detached): only the peers count.
  assert.equal(volumeState(status('Diskless', peer('Connected', 'UpToDate')), 'arkvory').copies, 1);
  // A peer must have every volume complete.
  const two = [
    {
      name: 'arkvory',
      role: 'Primary',
      devices: [
        { volume: 0, 'disk-state': 'UpToDate' },
        { volume: 1, 'disk-state': 'UpToDate' },
      ],
      connections: [peer('Connected', 'UpToDate')],
    },
  ];
  assert.equal(volumeState(two, 'arkvory').copies, 1);
});

test('an unexpected status is an error, never a number of copies', () => {
  for (const value of [
    null,
    {},
    [{ name: 'other', devices: [] }],
    status('UpToDate').map((r) => ({ ...r, devices: [] })),
  ])
    assert.throws(() => volumeState(value, 'arkvory'));
  assert.throws(() => volumeState([{ name: 'arkvory', devices: 'x' }], 'arkvory'));
});

test('a single-copy decision lowers the copies a write needs only until its time', () => {
  const decision = parseDecision({
    until: '2026-10-10T12:00:00.000Z',
    reason: 'node B is being replaced',
    decidedAt: '2026-10-10T10:00:00.000Z',
  });
  const before = Date.parse('2026-10-10T11:00:00Z');
  const after = Date.parse('2026-10-10T13:00:00Z');
  assert.deepEqual(replicaAnswer(1, 2, decision, before), {
    copies: 1,
    required: 1,
    singleCopyUntil: decision.until,
  });
  assert.deepEqual(replicaAnswer(1, 2, decision, after), {
    copies: 1,
    required: 2,
    singleCopyUntil: null,
  });
  assert.deepEqual(replicaAnswer(2, 2, null, after), {
    copies: 2,
    required: 2,
    singleCopyUntil: null,
  });
  assert.throws(() => parseDecision({ ...decision, reason: 'x' }));
  assert.throws(() => parseDecision({ ...decision, until: 'soon' }));
});

test('every caller gets a read that started after its call', async () => {
  let started = 0;
  const finishers = [];
  const reads = new FreshReads(
    () =>
      new Promise((resolve) => {
        const number = ++started;
        finishers.push(() => resolve(number));
      }),
  );
  const first = reads.get();
  await new Promise((resolve) => setImmediate(resolve));
  // Read 1 is under way: later callers must not get it, they share read 2.
  const second = reads.get();
  const third = reads.get();
  assert.equal(started, 1);
  finishers.shift()();
  assert.equal(await first, 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(started, 2);
  finishers.shift()();
  assert.equal(await second, 2);
  assert.equal(await third, 2);
});

test('cluster settings require two copies for a write and a socket under /run', () => {
  const settings = {
    profile: 'ha-3',
    resource: 'arkvory',
    requiredCopies: 2,
    socket: '/run/arkvory/replica.sock',
  };
  assert.deepEqual(parseCluster(settings), settings);
  for (const bad of [
    { ...settings, profile: 'ha-1' },
    { ...settings, requiredCopies: 1 },
    { ...settings, socket: '/tmp/replica.sock' },
    { ...settings, resource: 'Bad Name' },
  ])
    assert.throws(() => parseCluster(bad), JSON.stringify(bad));
});

test('the replica service answers fresh state, and 503 when the kernel state cannot be read', async (t) => {
  const path =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\arkvory-replica-${randomUUID()}`
      : join(tmpdir(), `arkvory-replica-${randomUUID()}.sock`);
  let volume = { role: 'Primary', copies: 2 };
  let failing = false;
  const settings = { profile: 'ha-2', resource: 'arkvory', requiredCopies: 2, socket: '/run/x' };
  const server = replicaServer(
    async () => {
      if (failing) throw new Error('drbdsetup failed');
      return volume;
    },
    settings,
    async () => null,
  );
  server.listen(path);
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const get = (url = '/state') =>
    new Promise((resolve, reject) => {
      const call = request({ socketPath: path, path: url }, (response) => {
        let body = '';
        response.on('data', (chunk) => (body += chunk));
        response.on('end', () => resolve({ status: response.statusCode, body }));
      });
      call.on('error', reject);
      call.end();
    });
  assert.deepEqual(JSON.parse((await get()).body), {
    copies: 2,
    required: 2,
    singleCopyUntil: null,
  });
  volume = { role: 'Primary', copies: 1 };
  assert.deepEqual(JSON.parse((await get()).body), {
    copies: 1,
    required: 2,
    singleCopyUntil: null,
  });
  failing = true;
  assert.equal((await get()).status, 503);
  assert.equal((await get('/other')).status, 404);
});
