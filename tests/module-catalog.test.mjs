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

function deferred() {
  return Promise.withResolvers();
}

async function lifecycleHandle(read, log) {
  const scopes = new AccessScopes();
  const root = scopes.of([reader]);
  const scope = scopes.intersect(root, scopes.of([reader]));
  const backend = { ...opened(log), read };
  const { content } = moduleCatalog({ content: async () => backend }, scopes);
  const handle = await content.open(scope, { repository: 'releases', id });
  return { handle, scopes, root, scope };
}

for (const fail of [false, true]) {
  test(`scope revocation waits for late backend ${fail ? 'failure' : 'chunk'} and cleanup`, async () => {
    const log = [];
    const entered = deferred();
    const operation = deferred();
    const cleaning = deferred();
    const cleanup = deferred();
    const f = await lifecycleHandle(async function* () {
      try {
        entered.resolve();
        await operation.promise;
        if (fail) throw new Error('backend failure');
        yield new Uint8Array(4);
      } finally {
        cleaning.resolve();
        await cleanup.promise;
        log.push('closed');
      }
    }, log);
    const stream = f.handle.read()[Symbol.asyncIterator]();
    const pending = assert.rejects(stream.next(), { code: 'unavailable' });
    await entered.promise;
    f.scopes.revoke(f.root);
    assert.deepEqual(f.scopes.principalsOf(f.scope), []);
    const releasing = f.handle.release();
    assert.strictEqual(f.handle.release(), releasing);
    await assert.rejects(gather(f.handle.read()), { code: 'unavailable' });
    assert.deepEqual(log, [], 'in-flight backend still owns the pin');
    operation.resolve();
    await cleaning.promise;
    assert.deepEqual(log, [], 'backend finally still owns the pin');
    cleanup.resolve();
    await Promise.all([pending, releasing]);
    assert.deepEqual(log, ['closed', 'released']);
  });
}

test('revocation closes every abandoned yield before releasing the shared handle pin', async () => {
  const log = [];
  const firstClosing = deferred();
  const secondClosing = deferred();
  const firstDone = deferred();
  const secondDone = deferred();
  let count = 0;
  const f = await lifecycleHandle(async function* () {
    const number = ++count;
    try {
      yield new Uint8Array(4);
    } finally {
      (number === 1 ? firstClosing : secondClosing).resolve();
      await (number === 1 ? firstDone : secondDone).promise;
      log.push(`closed-${number}`);
    }
  }, log);
  const first = f.handle.read()[Symbol.asyncIterator]();
  const second = f.handle.read()[Symbol.asyncIterator]();
  await first.next();
  await second.next();
  // Neither consumer calls next/return again: response finish/HEAD/304 must own cleanup.
  f.scopes.revoke(f.root);
  await Promise.all([firstClosing.promise, secondClosing.promise]);
  firstDone.resolve();
  await first.return();
  assert.deepEqual(log, ['closed-1'], 'the other reader still protects global unlink');
  secondDone.resolve();
  await f.handle.release();
  assert.deepEqual(log, ['closed-1', 'closed-2', 'released']);
  await assert.rejects(first.next(), { code: 'unavailable' });
  await assert.rejects(second.next(), { code: 'unavailable' });
});

test('release waits for sibling cleanup even when another backend return rejects', async () => {
  const log = [];
  const entered = deferred();
  const finish = deferred();
  let count = 0;
  const f = await lifecycleHandle(async function* () {
    const number = ++count;
    try {
      yield new Uint8Array(4);
    } finally {
      if (number === 1) throw new Error('cleanup failure');
      entered.resolve();
      await finish.promise;
      log.push('closed');
    }
  }, log);
  await f.handle.read()[Symbol.asyncIterator]().next();
  await f.handle.read()[Symbol.asyncIterator]().next();
  const released = assert.rejects(f.handle.release(), { code: 'unavailable' });
  await entered.promise;
  assert.deepEqual(log, []);
  finish.resolve();
  await released;
  assert.deepEqual(log, ['closed', 'released']);
});

test('revoking an unread handle releases without opening its backend', async () => {
  const log = [];
  const f = await lifecycleHandle(async function* () {
    log.push('unexpected read');
    yield new Uint8Array(4);
  }, log);
  const stream = f.handle.read()[Symbol.asyncIterator]();
  f.scopes.revoke(f.root);
  await f.handle.release();
  assert.deepEqual(log, ['released']);
  await assert.rejects(stream.next(), { code: 'unavailable' });
});
