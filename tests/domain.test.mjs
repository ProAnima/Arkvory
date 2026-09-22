import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDescriptor,
  sameDescriptor,
  authorize,
  requireId,
  MAX_OBJECT_BYTES,
} from '@proanima/depot-domain';
import { parseRange, matchesEtag, parseKeys } from '../apps/api/dist/index.js';
const valid = {
  name: 'archive.upack',
  size: '5368709120',
  sha256: 'a'.repeat(64),
  labels: ['release', 'release', 'linux'],
  metadata: { version: '1.0', platform: 'linux' },
};

test('descriptor enforces 5 GiB, flat metadata and canonical identity', () => {
  const a = parseDescriptor(valid);
  assert.equal(a.size, MAX_OBJECT_BYTES);
  assert.deepEqual(a.labels, ['linux', 'release']);
  assert(
    sameDescriptor(
      a,
      parseDescriptor({
        ...valid,
        labels: ['linux', 'release'],
        metadata: { platform: 'linux', version: '1.0' },
      }),
    ),
  );
  for (const patch of [
    { size: '5368709121' },
    { size: 2 },
    { size: '-1' },
    { size: '01' },
    { sha256: 'bad' },
    { name: '../x' },
    { name: 'x\u0000y' },
    { metadata: { bad: { nested: true } } },
    { labels: Array(33).fill('x') },
    { unexpected: true },
  ])
    assert.throws(() => parseDescriptor({ ...valid, ...patch }), { code: 'invalid_input' });
});

test('authorization requires both repository and operation scope; identifiers are path-safe', () => {
  const p = { id: 'reader', repositories: ['releases'], permissions: ['read'] };
  authorize(p, 'releases', 'read');
  assert.throws(() => authorize(p, 'secrets', 'read'), { code: 'forbidden' });
  assert.throws(() => authorize(p, 'releases', 'write'), { code: 'forbidden' });
  assert.throws(() => requireId('../secret'), { code: 'invalid_input' });
});

test('single Range handles boundaries, suffixes, huge integers, and unsupported multi ranges', () => {
  assert.deepEqual(parseRange('bytes=3-9', 6), { kind: 'partial', start: 3, end: 5 });
  assert.deepEqual(parseRange('bytes=-2', 6), { kind: 'partial', start: 4, end: 5 });
  assert.deepEqual(parseRange('bytes=2-', 6), { kind: 'partial', start: 2, end: 5 });
  assert.deepEqual(parseRange('bytes=999999999999999999999-', 6), { kind: 'unsatisfiable' });
  assert.deepEqual(parseRange('bytes=-0', 6), { kind: 'unsatisfiable' });
  assert.deepEqual(parseRange('bytes=0-0', 0), { kind: 'unsatisfiable' });
  assert.deepEqual(parseRange('bytes=0-1,4-5', 6), { kind: 'full' });
  assert.deepEqual(parseRange('bytes=4-1', 6), { kind: 'full' });
  assert(matchesEtag('W/"abc", "other"', '"abc"'));
  assert(!matchesEtag('"other"', '"abc"'));
});

test('key configuration rejects malformed credentials and permissions', () => {
  assert.throws(() => parseKeys([]));
  assert.throws(() =>
    parseKeys([{ id: 'a', sha256: 'a'.repeat(64), repositories: ['x'], permissions: ['admin'] }]),
  );
  assert.equal(
    parseKeys([{ id: 'a', sha256: 'a'.repeat(64), repositories: ['x'], permissions: ['read'] }])
      .length,
    1,
  );
});
