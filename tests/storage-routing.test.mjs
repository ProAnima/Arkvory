import test from 'node:test';
import assert from 'node:assert/strict';
import { RoutedBlobStore } from '../packages/infrastructure/dist/index.js';

function createMockStore(name) {
  const operations = [];
  return {
    name,
    operations,
    async put(id, descriptor, source, cancellation) {
      operations.push({ action: 'put', id, descriptor });
    },
    async exists(id, size) {
      operations.push({ action: 'exists', id, size });
      if (id === 'missing-in-' + name) throw new Error('Not found');
    },
    async verify(id, descriptor, cancellation) {
      operations.push({ action: 'verify', id, descriptor });
    },
    async *read(id, size, range) {
      operations.push({ action: 'read', id, size, range });
      yield new Uint8Array([1, 2, 3]);
    },
    async putPart(id, part, source, cancellation) {
      operations.push({ action: 'putPart', id, part });
    },
    async *readParts(id, parts) {
      operations.push({ action: 'readParts', id, parts });
      yield new Uint8Array([4, 5, 6]);
    },
    async collect(id, removeContent, cancellation) {
      operations.push({ action: 'collect', id, removeContent });
    },
    async ready() {
      operations.push({ action: 'ready' });
    },
    async initialize() {
      operations.push({ action: 'initialize' });
    },
    async identity() {
      return 'identity-' + name;
    },
    async checkSpace(needed) {
      operations.push({ action: 'checkSpace', needed });
    },
    contentPath(id) {
      return '/path/' + name + '/' + id;
    },
  };
}

test('routed blob store validates targets and dispatches operations to named backend', async () => {
  const fast = createMockStore('fast');
  const hdd = createMockStore('hdd');
  const routed = new RoutedBlobStore('fast', [
    { id: 'fast', store: fast },
    { id: 'hdd', store: hdd },
  ]);

  assert.throws(() => new RoutedBlobStore('missing', [{ id: 'fast', store: fast }]), {
    code: 'invalid_input',
  });
  assert.throws(
    () =>
      new RoutedBlobStore('fast', [
        { id: 'fast', store: fast },
        { id: 'fast', store: fast },
      ]),
    { code: 'conflict' },
  );

  // Dispatch to HDD target
  const dummyDesc = {
    name: 'pkg.upack',
    size: 1000,
    sha256: 'a'.repeat(64),
    labels: [],
    metadata: {},
  };
  await routed.put('art-1', dummyDesc, (async function* () {})(), { throwIfAborted() {} }, 'hdd');
  assert.equal(hdd.operations.length, 1);
  assert.equal(hdd.operations[0].action, 'put');
  assert.equal(fast.operations.length, 0);

  // Dispatch to default (fast) target when backendId not passed
  await routed.put('art-2', dummyDesc, (async function* () {})(), { throwIfAborted() {} });
  assert.equal(fast.operations.length, 1);
  assert.equal(fast.operations[0].action, 'put');

  // Verify read routing
  const hddChunks = [];
  for await (const chunk of routed.read('art-1', 1000, undefined, 'hdd')) {
    hddChunks.push(chunk);
  }
  assert.equal(hddChunks.length, 1);
  assert.equal(hdd.operations.at(-1).action, 'read');

  // Multi-target exists probe when backendId is omitted
  await routed.exists('missing-in-fast', 1000);
  assert.equal(fast.operations.at(-1).action, 'exists');
  assert.equal(hdd.operations.at(-1).action, 'exists');

  // Ready and initialize propagate to all targets
  await routed.ready();
  assert.ok(fast.operations.some((op) => op.action === 'ready'));
  assert.ok(hdd.operations.some((op) => op.action === 'ready'));

  // Content path returns target path
  assert.equal(routed.contentPath('art-1', 'hdd'), '/path/hdd/art-1');
  assert.equal(routed.contentPath('art-2', 'fast'), '/path/fast/art-2');
});
