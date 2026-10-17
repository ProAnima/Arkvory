import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { blobPathOwners, inspectBlobPaths } from '../scripts/policy/blob-paths.mjs';

const product = 'packages/infrastructure/src/example.ts';

test('the policy finds blob paths and unplaced reads outside the storage adapter', () => {
  // Each of these was how a consumer reached content before ADR 0083, N9.
  for (const [text, problem] of [
    ['open(this.blobs.contentPath(id), options, done);', 'blob content path'],
    ['const raw = new FileRawStaging(blobs.root, space);', 'storage root path'],
    ['if ((await readdir(this.blobs.root)).length) throw x;', 'storage root path'],
    ["const file = join(dataDirectory, 'blobs', id);", 'path into the blobs directory'],
    ["const file = resolve(root, 'data/blobs');", 'path into the blobs directory'],
    ['yield* this.blobs.read(entry.id, entry.size);', 'blobs.read without'],
    ['await blobs.verify(row.id, upload.descriptor, cancellation);', 'blobs.verify without'],
    ['await this.blobs.exists(id, size);', 'blobs.exists without'],
    ['await this.blobs.collect(id, true, cancellation);', 'blobs.collect without'],
  ]) {
    const found = inspectBlobPaths(product, text);
    assert.equal(found.length, 1, text);
    assert.match(found[0], new RegExp(`^${product}:1: ${problem}`), text);
  }
  const app = inspectBlobPaths('apps/worker/src/x.ts', 'store.root;');
  assert.equal(app.length, 1);
});

test('the policy sees through aliases, computed names and built path strings', () => {
  // The same reaches as above, written so that a check of the plain spelling misses them.
  for (const [text, problem] of [
    ['const content = this.blobs; yield* content.read(entry.id, entry.size);', 'content.read'],
    ['const { blobs: local } = deps; await local.verify(id, d, c);', 'local.verify without'],
    ['const a = this.blobs, b = (a as BlobStore); await b.exists(id, size);', 'b.exists'],
    ["await this.blobs['collect'](id, true, cancellation);", 'blobs.collect without'],
    ["const raw = new FileRawStaging(this.blobs['root'], space);", 'storage root path'],
    ['const { root } = this.blobs;', 'storage root path'],
    ['const { contentPath: where } = blobs;', 'blob content path'],
    ["open(blobs['contentPath'](id), options, done);", 'blob content path'],
    ['const file = join(dataDirectory, `blobs/${id}`);', 'path into the blobs directory'],
    ["const file = resolve(root, 'data' + '/blobs/' + id);", 'path into the blobs directory'],
    ["const file = join(root, 'data\\\\blobs');", 'path into the blobs directory'],
  ]) {
    const found = inspectBlobPaths(product, text);
    assert.equal(found.length, 1, `${text}: ${found.join('; ')}`);
    assert.match(found[0], new RegExp(`^${product}:1: ${problem}`), text);
  }
  for (const text of [
    'const settings = this.store; await settings.read();',
    'const url = `/v2/${name}/blobs/${digest}`; join(root, `releases/${id}`);',
    'await this.blobs.read(...placed);',
    'const { ready } = this.blobs; const { root } = options;',
  ])
    assert.deepEqual(inspectBlobPaths(product, text), [], text);
});

test('the policy allows the adapter, the vault, placed reads and other roots', () => {
  for (const [file] of blobPathOwners)
    assert.deepEqual(inspectBlobPaths(file, "join(this.root, 'blobs', id); x.contentPath;"), []);
  for (const text of [
    'yield* this.blobs.read(entry.id, entry.size, undefined, backend);',
    'await this.blobs.exists(id, size, upload.storageBackend);',
    'await blobs.verify(row.id, upload.descriptor, cancellation, upload.storageBackend);',
    "await requireSeparateTargets(command, vault.root, env); join(context.root, 'releases');",
    'this.root.append(this.rows); const url = `/v2/${name}/blobs/uploads/${id}`;',
    'await this.store.read();',
  ])
    assert.deepEqual(inspectBlobPaths(product, text), [], text);
  // Tests and scripts know the local layout; the rule is for the product.
  assert.deepEqual(inspectBlobPaths('tests/x.test.mjs', 'blobs.contentPath(id)'), []);
  assert.deepEqual(inspectBlobPaths('scripts/x.mjs', "join(root, 'blobs')"), []);
});

test('the product sources that read content name no blob path', async () => {
  for (const file of [
    'packages/infrastructure/src/upack.ts',
    'packages/infrastructure/src/backup-source.ts',
    'packages/infrastructure/src/restore-storage.ts',
    'apps/api/src/protocol-services.ts',
    'apps/worker/src/mirror-target.ts',
    'apps/worker/src/scrub.ts',
  ])
    assert.deepEqual(inspectBlobPaths(file, await readFile(file, 'utf8')), [], file);
});
