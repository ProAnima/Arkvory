import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { parseAttachments } from '@proanima/depot-domain';
import { readAttachmentRevision, readAttachmentHistory } from '@proanima/depot-contracts';

test('build attachment rules reject ambiguous names, unsafe paths, self links and unbounded input', () => {
  const parent = randomUUID(),
    entry = {
      name: 'build.json',
      kind: 'manifest',
      artifactId: randomUUID(),
      description: 'CI manifest 🚀',
    };
  assert.deepEqual(parseAttachments([entry], parent), [entry]);
  for (const invalid of [
    null,
    {},
    Array(33).fill(entry),
    [entry, { ...entry, name: 'BUILD.json' }],
    ...[
      { name: '../evil' },
      { name: ' bad ' },
      { name: 'bad\u0000' },
      { kind: 'script' },
      { description: 'x'.repeat(513) },
      { description: 'bad\u0000' },
      { description: 'bad\uD800' },
      { description: 'bad\uDFFF' },
      { artifactId: parent },
      { artifactId: 'invalid' },
      { extra: true },
    ].map((patch) => [{ ...entry, ...patch }]),
  ])
    assert.throws(() => parseAttachments(invalid, parent), { code: 'invalid_input' });
});

test('SDK attachment parser enforces bounded history, revision ordering and valid cursors', () => {
  const current = {
    revision: 1,
    items: [{ name: 'manifest.json', kind: 'manifest', artifactId: randomUUID(), description: '' }],
    actor: 'ci',
    createdAt: '2026-09-25T12:00:00.000Z',
  };
  assert.deepEqual(readAttachmentRevision(current), current);
  assert.deepEqual(
    readAttachmentRevision({ revision: 0, items: [], actor: null, createdAt: null }),
    { revision: 0, items: [], actor: null, createdAt: null },
  );
  for (const patch of [
    { revision: 0 },
    { revision: 2147483648 },
    { actor: null },
    { createdAt: 'not-a-date' },
    { items: Array(33).fill(current.items[0]) },
    { items: [current.items[0], current.items[0]] },
  ])
    assert.throws(() => readAttachmentRevision({ ...current, ...patch }));
  const page = {
    items: Array.from({ length: 20 }, (_, i) => ({ ...current, revision: 25 - i })),
    next: 6,
  };
  assert.deepEqual(readAttachmentHistory(page), page);
  for (const invalid of [
    { ...page, next: 5 },
    { items: [current, current], next: null },
    { items: Array(21).fill(current), next: null },
    { items: [], next: 1 },
  ])
    assert.throws(() => readAttachmentHistory(invalid));
});
