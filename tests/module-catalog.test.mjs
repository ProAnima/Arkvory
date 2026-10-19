import test from 'node:test';
import assert from 'node:assert/strict';
import { GlobalSearch, ScopedCatalog } from '@proanima/arkvory-application';
import { ArkvoryError } from '@proanima/arkvory-domain';
import { AccessScopes, moduleCatalog } from '@proanima/arkvory-infrastructure';

// The module side of `catalog-read` and `content-read` (ADR 0083, N4) on fakes of the core's
// use cases: pins are released on every refusal, ranges are checked before the storage sees
// them, malformed input is refused whatever the rights.
const id = '00000000-0000-4000-8000-000000000001';
const reader = {
  credential: 'file-key',
  id: 'reader',
  repositories: ['releases'],
  permissions: ['read'],
};

function opened(log) {
  return {
    upload: { id, repository: 'releases', descriptor: { size: 4, sha256: 'a'.repeat(64) } },
    async *read(range) {
      log.push(range ?? 'all');
      yield new Uint8Array(range ? range.end - range.start + 1 : 4);
    },
    pin: {
      check() {},
      release: async () => {
        log.push('released');
      },
    },
  };
}

function services(log) {
  const scopes = new AccessScopes();
  const { content } = moduleCatalog({ content: async () => opened(log) }, scopes);
  return { content, scope: scopes.of([reader]) };
}

const gather = async (source) => {
  let bytes = 0;
  for await (const chunk of source) bytes += chunk.byteLength;
  return bytes;
};

test('a malformed range is refused before anything is pinned, a range past the end unpins', async () => {
  const log = [];
  const { content, scope } = services(log);
  const ref = { repository: 'releases', id };
  for (const range of [
    null,
    7,
    { start: -1, end: 2 },
    { start: 3, end: 1 },
    { start: '0', end: 1 },
  ])
    await assert.rejects(content.open(scope, ref, range), { code: 'invalid_input' });
  assert.deepEqual(log, [], 'nothing pinned, nothing read');
  await assert.rejects(content.open(scope, ref, { start: 0, end: 4 }), { code: 'invalid_input' });
  assert.deepEqual(log, ['released']);
});

test('a handle reads only ranges inside the blob, by default the range it was opened with', async () => {
  const log = [];
  const { content, scope } = services(log);
  const handle = await content.open(scope, { repository: 'releases', id }, { start: 1, end: 2 });
  assert.equal(await gather(handle.read()), 2);
  assert.equal(await gather(handle.read({ start: 0, end: 3 })), 4);
  await assert.rejects(gather(handle.read({ start: 0, end: 4 })), { code: 'invalid_input' });
  await assert.rejects(gather(handle.read({ start: 2, end: 1 })), { code: 'invalid_input' });
  assert.deepEqual(
    log,
    [
      { start: 1, end: 2 },
      { start: 0, end: 3 },
    ],
    'the storage saw exact ranges',
  );
  await handle.release();
  await handle.release();
  await assert.rejects(gather(handle.read()), { code: 'unavailable' });
  assert.deepEqual(log.slice(2), ['released']);
});

test('a malformed package query is invalid_input whatever the rights', async () => {
  const forbidden = async () => {
    throw new ArkvoryError('forbidden', 'Forbidden');
  };
  const scoped = new ScopedCatalog({ artifact: forbidden }, { resolvePackage: forbidden }, {}, {});
  for (const query of [
    { group: 'g', name: '', version: null },
    { group: 'g', name: 'n'.repeat(129), version: null },
    { group: 7, name: 'n', version: null },
    { group: 'g', name: 'n', version: 'v'.repeat(129) },
  ])
    await assert.rejects(scoped.resolvePackage([reader], 'releases', query), {
      code: 'invalid_input',
    });
  assert.equal(
    await scoped.resolvePackage([reader], 'releases', { group: 'g', name: 'n', version: null }),
    null,
  );
});

test('a search with several principals intersects their repositories before the cap', async () => {
  const names = (prefix) =>
    Array.from({ length: 1000 }, (_, i) => `${prefix}${String(i).padStart(4, '0')}`);
  const lister = (id, repositories) => ({
    credential: 'file-key',
    id,
    repositories,
    permissions: ['read'],
  });
  // The first principal may list 1000 repositories named before the one both may list.
  const first = lister('first', [...names('a'), 'shared']);
  const second = lister('second', ['shared']);
  const searched = [];
  const search = new GlobalSearch({
    searchRepositories: async ({ repositories }) => {
      searched.push([...repositories]);
      return [];
    },
  });
  await search.searchAll([first, second], {});
  await search.searchAll([second, first], {});
  assert.deepEqual(searched, [['shared'], ['shared']]);
});

test('revocation follows intersections and closes handles opened before or during revocation', async () => {
  const scopes = new AccessScopes();
  const root = scopes.of([reader]);
  const child = scopes.intersect(scopes.of([reader]), root);
  const grandchild = scopes.intersect(child, child);
  const log = [];
  let resolve;
  const pending = new Promise((r) => {
    resolve = r;
  });
  const { content } = moduleCatalog({ content: () => pending }, scopes);
  const opening = content.open(grandchild, { repository: 'releases', id });
  scopes.revoke(root);
  assert.deepEqual(scopes.principalsOf(grandchild), []);
  assert.deepEqual(scopes.principalsOf(scopes.intersect(child, scopes.of([reader]))), []);
  resolve(opened(log));
  assert.equal(await opening, null);
  assert.deepEqual(log, ['released']);
  assert.deepEqual(new AccessScopes().principalsOf(child), []);
});
