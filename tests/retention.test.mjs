import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authorizeAction,
  parseDeletionSelection,
  parseRetentionCriteria,
} from '@proanima/arkvory-domain';
import { readDeletionResult, readRetentionPreview } from '@proanima/arkvory-contracts';
const id = '00000000-0000-4000-8000-000000000001';
const now = '2026-09-25T10:00:00.000Z';
test('retention requires explicit bounded filters and selection; coarse grants never acquire deletion', () => {
  const valid = { publishedBefore: now, protectedLabels: ['release', 'bse'] };
  assert.deepEqual(parseRetentionCriteria(valid, now), valid);
  for (const criteria of [
    { ...valid, extra: true },
    { ...valid, publishedBefore: '2026-02-30T00:00:00.000Z' },
    { ...valid, publishedBefore: '2027-01-01T00:00:00.000Z' },
    { ...valid, protectedLabels: ['release', 'release'] },
    { ...valid, protectedLabels: Array(33).fill('a') },
    { publishedBefore: now },
  ])
    assert.throws(() => parseRetentionCriteria(criteria, now), { code: 'invalid_input' });
  for (const selection of [
    [],
    [
      { id, expectedAnnotationRevision: 0 },
      { id, expectedAnnotationRevision: 0 },
    ],
    [{ id, expectedAnnotationRevision: 2147483648 }],
    [{ id, expectedAnnotationRevision: 0, extra: 1 }],
  ])
    assert.throws(() => parseDeletionSelection(selection), { code: 'invalid_input' });
  for (const legacy of [null, []])
    assert.throws(
      () =>
        authorizeAction(
          {
            id: 'root',
            permissions: ['read', 'write'],
            repositories: ['releases'],
            administrator: true,
            serviceAdministrator: true,
          },
          'releases',
          'artifact.delete',
          legacy,
        ),
      { code: 'forbidden' },
    );
});
test('retention wire parsers reject ambiguous outcomes, oversized pages and unsafe size values', () => {
  const row = {
    id,
    name: 'build.zip',
    size: '5368709120',
    publishedAt: now,
    annotationRevision: 0,
    blockers: [],
  };
  assert.deepEqual(readRetentionPreview({ items: [row], next: null }), {
    items: [row],
    next: null,
  });
  for (const value of [
    { items: [row, row], next: id },
    { items: [{ ...row, size: '5368709121' }], next: null },
    { items: [{ ...row, publishedAt: 'invalid' }], next: null },
    { items: [{ ...row, blockers: ['unknown'] }], next: null },
    { items: [], next: id },
  ])
    assert.throws(() => readRetentionPreview(value));
  for (const value of [
    { id, outcome: 'deleted', blockers: ['reference'] },
    { id, outcome: 'protected', blockers: [] },
    { id, outcome: 'unknown', blockers: [] },
  ])
    assert.throws(() => readDeletionResult(value));
});
