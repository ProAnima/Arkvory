import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDescriptor,
  sameDescriptor,
  authorize,
  requireId,
  MAX_OBJECT_BYTES,
  partSize,
  checkParts,
  PART_BYTES,
  MAX_PART_BYTES,
  MAX_PARTS,
  partBytesFor,
  requirePartBytes,
  matchRoutingRule,
  resolveStorageBackend,
} from '@proanima/arkvory-domain';
import { parseRange, matchesEtag, parseKeys } from '../apps/api/dist/index.js';
const valid = {
  name: 'archive.upack',
  size: String(MAX_OBJECT_BYTES),
  sha256: 'a'.repeat(64),
  labels: ['release', 'release', 'linux'],
  metadata: { version: '1.0', platform: 'linux' },
};

test('descriptor accepts the full multipart layout, flat metadata and canonical identity', () => {
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
    { size: String(MAX_OBJECT_BYTES + 1) },
    { size: 2 },
    { size: '-1' },
    { size: '01' },
    { sha256: 'bad' },
    { name: '../x' },
    { name: 'x\u0000y' },
    { name: 'x\uD800y' },
    { name: 'x\uDFFFy' },
    { metadata: { bad: { nested: true } } },
    { metadata: { bad: 'before\u0000after' } },
    { metadata: { bad: 'before\uD800after' } },
    { metadata: { bad: 'before\uDFFFafter' } },
    { labels: Array(33).fill('x') },
    { unexpected: true },
  ])
    assert.throws(() => parseDescriptor({ ...valid, ...patch }), { code: 'invalid_input' });
});

test('descriptor preserves valid Unicode pairs and non-NUL metadata controls', () => {
  const descriptor = { ...valid, name: 'build-🚀.upack', metadata: { notes: '🚀\n\t\u0001' } };
  const parsed = parseDescriptor(descriptor);
  assert.equal(parsed.name, descriptor.name);
  assert.deepEqual(parsed.metadata, descriptor.metadata);
});

test('authorization requires both repository and operation scope; identifiers are path-safe', () => {
  const p = { id: 'reader', repositories: ['releases'], permissions: ['read'] };
  authorize(p, 'releases', 'read');
  assert.throws(() => authorize(p, 'secrets', 'read'), { code: 'forbidden' });
  assert.throws(() => authorize(p, 'releases', 'write'), { code: 'forbidden' });
  assert.throws(() => requireId('../secret'), { code: 'invalid_input' });
});

test('group grants do not combine repository and action into broader access', () => {
  const principal = {
    id: 'user:one',
    repositories: [],
    permissions: [],
    grants: [
      { repository: 'public', permissions: ['read'] },
      { repository: 'private', permissions: ['read', 'write'] },
    ],
  };
  authorize(principal, 'public', 'read');
  authorize(principal, 'private', 'write');
  assert.throws(() => authorize(principal, 'public', 'write'), { code: 'forbidden' });
  assert.throws(() => authorize(principal, 'other', 'read'), { code: 'forbidden' });
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

test('multipart partSize supports 10 GiB, 20 GiB and 64 GiB boundaries', () => {
  const tenGiB = 10 * 1024 ** 3;
  const twentyGiB = 20 * 1024 ** 3;
  const sixtyFourGiB = 64 * 1024 ** 3;
  assert.equal(Math.ceil(tenGiB / PART_BYTES), 1280);
  assert.equal(partSize(tenGiB, 0), PART_BYTES);
  assert.equal(partSize(tenGiB, 1279), PART_BYTES);
  assert.throws(() => partSize(tenGiB, 1280), { code: 'invalid_input' });

  assert.equal(Math.ceil(twentyGiB / PART_BYTES), 2560);
  assert.equal(partSize(twentyGiB, 0), PART_BYTES);
  assert.equal(partSize(twentyGiB, 2559), PART_BYTES);
  assert.throws(() => partSize(twentyGiB, 2560), { code: 'invalid_input' });

  assert.equal(Math.ceil(sixtyFourGiB / PART_BYTES), 8192);
  assert.equal(partSize(sixtyFourGiB, 8191), PART_BYTES);
  assert.throws(() => partSize(sixtyFourGiB, 8192), { code: 'invalid_input' });

  // Verify small non-round size calculation
  const uneven = twentyGiB + 123456;
  const partsCount = Math.ceil(uneven / PART_BYTES);
  assert.equal(partsCount, 2561);
  assert.equal(partSize(uneven, 2560), 123456);
});

test('part layout grows by powers of two so any size up to the layout limit fits 10000 parts', () => {
  assert.equal(MAX_OBJECT_BYTES, MAX_PARTS * MAX_PART_BYTES);
  assert.equal(partBytesFor(0), PART_BYTES);
  assert.equal(partBytesFor(20 * 1024 ** 3), PART_BYTES);
  assert.equal(partBytesFor(MAX_PARTS * PART_BYTES), PART_BYTES);
  assert.equal(partBytesFor(MAX_PARTS * PART_BYTES + 1), 2 * PART_BYTES);
  assert.equal(partBytesFor(200 * 1024 ** 3), 32 * 1024 ** 2);
  assert.equal(partBytesFor(4 * 1024 ** 4), 512 * 1024 ** 2);
  assert.equal(partBytesFor(MAX_OBJECT_BYTES), MAX_PART_BYTES);
  for (const size of [1, 5 * 1024 ** 3, 100 * 1024 ** 3 + 7, 3 * 1024 ** 4 + 1, MAX_OBJECT_BYTES]) {
    const bytes = partBytesFor(size);
    assert.ok(Math.ceil(size / bytes) <= MAX_PARTS, String(size));
    assert.equal(requirePartBytes(bytes), bytes);
    const last = Math.ceil(size / bytes) - 1;
    assert.equal(partSize(size, last, bytes), size - last * bytes);
    assert.throws(() => partSize(size, last + 1, bytes), { code: 'invalid_input' });
  }
  for (const size of [-1, 1.5, MAX_OBJECT_BYTES + 1])
    assert.throws(() => partBytesFor(size), { code: 'invalid_input' });
  for (const bytes of [0, PART_BYTES - 1, 3 * PART_BYTES, 2 * MAX_PART_BYTES, PART_BYTES + 0.5])
    assert.throws(() => requirePartBytes(bytes), { code: 'invalid_input' });
  const sixteen = 2 * PART_BYTES;
  const size = 100 * 1024 ** 3;
  const parts = Array.from({ length: Math.ceil(size / sixteen) }, (_, index) => ({
    index,
    size: partSize(size, index, sixteen),
    sha256: '0'.repeat(64),
  }));
  checkParts(size, parts, sixteen);
  assert.throws(() => checkParts(size, parts, PART_BYTES), { code: 'conflict' });
});

test('storage routing rules match repository, package group and size thresholds', () => {
  const rules = [
    {
      id: 'models-rule',
      backendId: 'large-hdd',
      packageGroup: 'models/*',
    },
    {
      id: 'heavy-assets',
      backendId: 'secondary-disk',
      repository: 'assets',
      minSizeBytes: 10 * 1024 ** 3,
    },
    {
      id: 'exact-group',
      backendId: 'fast-ssd',
      packageGroup: 'core-tools',
    },
  ];

  // Group prefix wildcard matching
  assert.equal(
    resolveStorageBackend(rules, { repository: 'releases', packageGroup: 'models/nlp', size: 100 }),
    'large-hdd',
  );
  assert.equal(
    resolveStorageBackend(rules, { repository: 'releases', packageGroup: 'models', size: 100 }),
    'large-hdd',
  );
  assert.equal(
    resolveStorageBackend(rules, {
      repository: 'releases',
      packageGroup: 'other/models',
      size: 100,
    }),
    'default',
  );

  // Size threshold on repository
  assert.equal(
    resolveStorageBackend(rules, { repository: 'assets', size: 12 * 1024 ** 3 }),
    'secondary-disk',
  );
  assert.equal(
    resolveStorageBackend(rules, { repository: 'assets', size: 2 * 1024 ** 3 }),
    'default',
  );

  // Exact group match
  assert.equal(
    resolveStorageBackend(rules, { repository: 'releases', packageGroup: 'core-tools', size: 500 }),
    'fast-ssd',
  );

  // Default fallback
  assert.equal(resolveStorageBackend(rules, { repository: 'random', size: 100 }), 'default');
  assert.equal(
    resolveStorageBackend(rules, { repository: 'random', size: 100 }, 'custom-fallback'),
    'custom-fallback',
  );
});
