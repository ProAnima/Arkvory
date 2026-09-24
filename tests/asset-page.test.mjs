import test from 'node:test';
import assert from 'node:assert/strict';
import { assetPrefixEnd, validateAssetPage } from '@proanima/depot-application';
import { readAssetPage } from '@proanima/depot-contracts';

test('asset prefix ranges preserve literal UTF-8 order including maximal Unicode suffixes', () => {
  for (const [prefix, expected] of [
    ['', null],
    ['a/', 'a0'],
    ['a%', 'a&'],
    ['a_', 'a`'],
    ['я', 'ѐ'],
    ['\ud7ff', '\ue000'],
    ['a\u{10ffff}', 'b'],
    ['\u{10ffff}', null],
    ['😀', '😁'],
  ])
    assert.equal(assetPrefixEnd(prefix), expected);
  for (const prefix of ['folder/', '100%_', '😀', '\u{10ffff}'])
    validateAssetPage({ prefix, limit: 50 });
  for (const prefix of ['a\0', 'a\n', '\ud800', 'a'.repeat(1025)])
    assert.throws(() => validateAssetPage({ prefix, limit: 50 }), { code: 'invalid_input' });
  for (const limit of [0, 101, 1.5, NaN, Infinity])
    assert.throws(() => validateAssetPage({ prefix: '', limit }), { code: 'invalid_input' });
});

test('asset page parser rejects unbounded, unordered, duplicate or malformed server results', () => {
  const row = (path) => ({ path, revision: 1, artifactId: '5b8a2644-6ff8-48af-8788-00ddecd3fc7d' });
  const page = { items: [row('\ue000'), row('😀')], next: 'opaque' };
  assert.deepEqual(readAssetPage(page, 2), page);
  assert.deepEqual(readAssetPage({ items: [], next: null }), { items: [], next: null });
  for (const value of [
    { ...page, items: [...page.items].reverse() },
    { ...page, items: [row('same'), row('same')] },
    { ...page, next: '' },
    { ...page, next: '='.repeat(10) },
    { ...page, next: 'a'.repeat(8193) },
    { items: [], next: 'opaque' },
    { items: [row('\ud800')], next: null },
    { items: [row('')], next: null },
    { items: Array.from({ length: 101 }, (_, i) => row(String(i).padStart(3, '0'))), next: null },
    { items: [], next: 3 },
    { items: [{ ...row('a'), revision: 0 }], next: null },
  ])
    assert.throws(() => readAssetPage(value, 2));
});
