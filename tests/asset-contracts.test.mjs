import test from 'node:test';
import assert from 'node:assert/strict';
import { readAsset, readAssetRevision, readAssetHistory } from '@proanima/arkvory-contracts';

test('asset response parsers reject malformed revisions, history order and cursors', () => {
  const row = {
    path: 'a.bin',
    artifactId: 'a',
    revision: 2,
    actor: 'writer',
    createdAt: '2026-09-22T00:00:00.000Z',
    sourceRevision: 1,
  };
  assert.deepEqual(readAssetRevision(row), row);
  for (const revision of [0, -1, 2.5, 2147483648, '2'])
    assert.throws(() => readAsset({ ...row, revision }));
  for (const sourceRevision of [0, 2, 3, undefined])
    assert.throws(() => readAssetRevision({ ...row, sourceRevision }));
  assert.throws(() => readAssetRevision({ ...row, createdAt: 'invalid' }));
  assert.throws(() => readAssetHistory({ items: [row, row], next: null }));
  assert.throws(() => readAssetHistory({ items: [row], next: 2 }));
  assert.deepEqual(readAssetHistory({ items: [], next: null }), { items: [], next: null });
  const old = { ...row, revision: 1, actor: null, createdAt: null, sourceRevision: null };
  assert.deepEqual(readAssetHistory({ items: [row, old], next: null }).items, [row, old]);
  assert.throws(() => readAssetHistory({ items: [row, { ...old, path: 'other' }], next: null }));
});
