import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  DownloadLeaseWindow,
  PostgresDownloadLease,
  downloadShare,
} from '@proanima/arkvory-infrastructure';

test('lease deadlines include request latency and expire before the server reservation', () => {
  let mono = 1000,
    wall = 100000;
  const lease = new DownloadLeaseWindow(
    () => mono,
    () => wall,
  );
  const request = lease.begin();
  mono += 7000;
  wall += 7000;
  lease.accept(request, true);
  assert.equal(lease.active, true);
  mono += 1000;
  wall += 1000;
  assert.equal(lease.active, false);
  assert.throws(() => lease.accept(lease.begin()), { code: 'unavailable' });
  assert.throws(() => lease.accept(lease.begin(), true), { code: 'unavailable' });
});

test('late heartbeat and process suspend cannot revive an expired lease', () => {
  let mono = 1000,
    wall = 100000;
  const lease = new DownloadLeaseWindow(
    () => mono,
    () => wall,
  );
  lease.accept(lease.begin(), true);
  mono += 2000;
  wall += 2000;
  const heartbeat = lease.begin();
  mono += 6000;
  wall += 6000;
  assert.throws(() => lease.accept(heartbeat), { code: 'unavailable' });
  const paused = new DownloadLeaseWindow(
    () => mono,
    () => wall,
  );
  paused.accept(paused.begin(), true);
  wall += 9000;
  assert.equal(paused.active, false);
  wall -= 9000;
  assert.equal(paused.active, false);
  const late = new DownloadLeaseWindow(
    () => mono,
    () => wall,
  );
  const start = late.begin();
  mono += 9000;
  assert.throws(() => late.accept(start, true), { code: 'unavailable' });
});

test('fixed shares cannot multiply the configured aggregate rate', () => {
  for (const slots of [2, 3, 16]) {
    let global = 0,
      principal = 0;
    for (let slot = 0; slot < slots; slot++) {
      const share = downloadShare({
        slots,
        slot,
        bytesPerSecond: 17 * 65536 + 13,
        perPrincipalBytesPerSecond: 17 * 65536 + 3,
      });
      global += share.bytesPerSecond;
      principal += share.perPrincipalBytesPerSecond;
    }
    assert(global <= 17 * 65536 + 13);
    assert(principal <= 17 * 65536 + 3);
  }
  for (const patch of [
    { slots: 1 },
    { slot: 2 },
    { slot: -1 },
    { bytesPerSecond: 65536 },
    { perPrincipalBytesPerSecond: 1 },
  ])
    assert.throws(() =>
      downloadShare({
        slots: 2,
        slot: 0,
        bytesPerSecond: 131072,
        perPrincipalBytesPerSecond: 0,
        ...patch,
      }),
    );
});

test('a reset of the kept lease connection loses the lease instead of crashing the process', async () => {
  // A pool client as pg gives it: an emitter whose 'error' throws when nobody listens.
  const client = Object.assign(new EventEmitter(), {
    released: null,
    async query(text) {
      const sql = typeof text === 'string' ? text : text.text;
      if (sql.startsWith('SELECT 1 FROM arkvory_download_policy')) return { rowCount: 1, rows: [] };
      if (sql.includes('RETURNING generation')) return { rowCount: 1, rows: [{ generation: '1' }] };
      return { rowCount: 0, rows: [] };
    },
    release(destroy) {
      this.released = destroy;
    },
  });
  const pool = { connect: async () => client };
  const lease = new PostgresDownloadLease(pool, {
    slots: 2,
    slot: 1,
    bytesPerSecond: 2 * 65536,
    perPrincipalBytesPerSecond: 2 * 65536,
  });
  await lease.start();
  assert.equal(lease.active, true);
  client.emit('error', new Error('terminating connection due to administrator command'));
  assert.equal(lease.active, false);
  assert.equal(client.released, true, 'the broken session is destroyed, never pooled');
  await assert.rejects(lease.renew(), { code: 'unavailable' });
});
