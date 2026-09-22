import test from 'node:test';
import assert from 'node:assert/strict';
import { GarbageCollector } from '@proanima/depot-application';
import { parseManifest, compareVersions, partSize, checkParts } from '@proanima/depot-domain';

test('cleanup never releases a reservation when byte deletion fails', async () => {
  let released = false;
  const row = {
    id: '00000000-0000-4000-8000-000000000001',
    repository: 'releases',
    status: 'cancelled',
    cancelledAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-01-01T00:00:00.000Z',
  };
  const gc = new GarbageCollector(
    {
      async page(after) {
        return after ? [] : [row];
      },
      async expire() {
        throw new Error('Unexpected expiry');
      },
      async reclaimed() {
        released = true;
      },
    },
    {
      async collect() {
        throw new Error('Disk deletion failed');
      },
    },
  );
  await assert.rejects(gc.run('2026-01-03T00:00:00.000Z'));
  assert.equal(released, false);
});
test('UPack identity, SemVer precedence and part coverage reject ambiguous inputs', () => {
  assert(compareVersions('2.0.0', '1.999.999') > 0);
  assert(compareVersions('1.0.0', '1.0.0-rc.1') > 0);
  assert(compareVersions('1.0.0-rc.10', '1.0.0-rc.2') > 0);
  assert.equal(compareVersions('1.0.0+a', '1.0.0+b'), 0);
  for (const value of [
    { name: '..', version: '1.0.0' },
    { name: 'x', group: 'a/../b', version: '1.0.0' },
    { name: 'x', version: '1.0.0-01' },
  ])
    assert.throws(() => parseManifest(value));
  assert.equal(partSize(8388609, 1), 1);
  assert.throws(() => partSize(8388609, 2));
  assert.throws(() => checkParts(8388609, [{ index: 1, size: 1, sha256: '0'.repeat(64) }]));
});
