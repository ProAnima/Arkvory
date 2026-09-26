import test from 'node:test';
import assert from 'node:assert/strict';
import { GarbageCollector } from '@proanima/arkvory-application';
import {
  parseManifest,
  compareVersions,
  partSize,
  checkParts,
  requireAssetPath,
} from '@proanima/arkvory-domain';

test('asset paths preserve valid Unicode and reject unpaired surrogates before encoding', () => {
  assert.equal(requireAssetPath('builds/🚀/данные.zip'), 'builds/🚀/данные.zip');
  for (const path of ['builds/\ud800.zip', 'builds/\udfff.zip'])
    assert.throws(() => requireAssetPath(path), { code: 'invalid_input' });
});

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
      exclusive: (_id, _content, action) => action({ throwIfAborted() {} }),
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
    { throwIfAborted() {} },
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

test('UPack nested metadata rejects unpersistable Unicode without rewriting valid text', () => {
  const original = { name: 'x', version: '1.0.0', _custom: [{ '🚀': 'text 🚀\n\t\u0001' }] };
  assert.deepEqual(parseManifest(original).original, original);
  for (const invalid of ['\u0000', '\uD800', '\uDFFF']) {
    for (const _custom of [[{ nested: invalid }], [{ [invalid]: 'value' }]])
      assert.throws(() => parseManifest({ ...original, _custom }), { code: 'invalid_input' });
  }
  assert.throws(() => parseManifest({ ...original, _custom: [Infinity] }), {
    code: 'invalid_input',
  });
});

test('UPack metadata traversal has bounded depth and rejects cycles', () => {
  const manifest = { name: 'x', version: '1.0.0', _custom: [] };
  let nested = manifest._custom;
  for (let depth = 0; depth < 127; depth++) {
    const next = [];
    nested.push(next);
    nested = next;
  }
  assert.equal(parseManifest(manifest).name, 'x');
  nested.push([]);
  assert.throws(() => parseManifest(manifest), { code: 'invalid_input' });
  const cyclic = { name: 'x', version: '1.0.0' };
  cyclic._custom = cyclic;
  assert.throws(() => parseManifest(cyclic), { code: 'invalid_input' });
});
