import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GlobalSearch,
  GLOBAL_SEARCH_REPOSITORIES,
  decodeSearchCursor,
  encodeSearchCursor,
  listableRepositories,
} from '@proanima/arkvory-application';
import { readGlobalSearchPage, openApiDocument } from '@proanima/arkvory-contracts';

const ID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const legacy = (grants) => ({ id: 'reader', repositories: [], permissions: [], grants });
const managed = (bindings) => ({
  id: 'svc',
  repositories: [],
  permissions: [],
  managed: {
    accountId: 'a',
    keyId: 'k',
    bindings: bindings.map(([id, actions]) => ({ resource: { kind: 'repository', id }, actions })),
  },
});
/** A store that records the filter and answers with `count` rows in keyset order. */
function store(count = 0) {
  const calls = [];
  return {
    calls,
    async searchRepositories(filter, limit) {
      calls.push({ filter, limit });
      return Array.from({ length: Math.min(count, limit) }, (_, i) => ({
        item: {
          repository: filter.repositories[0],
          id: ID(i + 1),
          name: `a${i}`,
          size: '1',
          createdAt: '2026-01-01T00:00:00.000Z',
          publishedAt: '2026-01-01T00:00:00.000Z',
          labels: [],
          stages: [],
        },
        position: { micros: String(1000 - i), repository: filter.repositories[0], id: ID(i + 1) },
      }));
    },
  };
}

test('global search reads only repositories the caller may list, without an existence oracle', async () => {
  const principal = managed([
    ['alpha', ['artifact.list', 'repository.read']],
    ['beta', ['artifact.read']],
    ['gamma', ['artifact.list']],
  ]);
  assert.deepEqual(listableRepositories(principal), ['alpha', 'gamma']);
  const s = store(1);
  const search = new GlobalSearch(s);
  await search.search(principal, {});
  assert.deepEqual(s.calls[0].filter.repositories, ['alpha', 'gamma']);
  // An unreadable and an absent repository give the same empty answer without a query.
  const forbidden = await search.search(principal, { repositories: 'beta' });
  const absent = await search.search(principal, { repositories: 'nowhere' });
  assert.deepEqual(forbidden, { items: [], next: null });
  assert.deepEqual(absent, forbidden);
  assert.equal(s.calls.length, 1);
  await search.search(principal, { repositories: 'gamma,beta,gamma' });
  assert.deepEqual(s.calls[1].filter.repositories, ['gamma']);
  // Legacy read grants list; a write-only grant does not.
  assert.deepEqual(
    listableRepositories(
      legacy([
        { repository: 'r1', permissions: ['read'] },
        { repository: 'w1', permissions: ['write'] },
      ]),
    ),
    ['r1'],
  );
  assert.deepEqual(await new GlobalSearch(store()).search(legacy([]), {}), {
    items: [],
    next: null,
  });
});

test('global search reads at most the first 1000 listable repositories by name', () => {
  const names = Array.from(
    { length: GLOBAL_SEARCH_REPOSITORIES + 5 },
    (_, i) => `r${String(i).padStart(5, '0')}`,
  );
  const principal = legacy(
    names.reverse().map((repository) => ({ repository, permissions: ['read'] })),
  );
  const allowed = listableRepositories(principal);
  assert.equal(allowed.length, GLOBAL_SEARCH_REPOSITORIES);
  assert.equal(allowed[0], 'r00000');
  assert.equal(allowed.at(-1), 'r00999');
});

test('global search pages with an opaque keyset cursor and asks for one extra row', async () => {
  const principal = legacy([{ repository: 'alpha', permissions: ['read'] }]);
  const full = store(3);
  const page = await new GlobalSearch(full).search(principal, { limit: '2', labels: 'b,a,b' });
  assert.equal(full.calls[0].limit, 3);
  assert.deepEqual(full.calls[0].filter.labels, ['a', 'b']);
  assert.equal(page.items.length, 2);
  assert.equal(page.items[0].repository, 'alpha');
  assert.equal(Object.hasOwn(page.items[0], 'position'), false);
  assert.equal(page.next, `999.alpha.${ID(2)}`);
  assert.deepEqual(decodeSearchCursor(page.next), {
    micros: '999',
    repository: 'alpha',
    id: ID(2),
  });
  const next = store(0);
  await new GlobalSearch(next).search(principal, { after: page.next });
  assert.deepEqual(next.calls[0].filter.after, decodeSearchCursor(page.next));
  const last = await new GlobalSearch(store(2)).search(principal, { limit: '2' });
  assert.equal(last.next, null);
  assert.equal(encodeSearchCursor({ micros: '-5', repository: 'r', id: ID(1) }), `-5.r.${ID(1)}`);
});

test('global search rejects malformed filters with a field and problem', async () => {
  const search = new GlobalSearch(store());
  const principal = legacy([{ repository: 'alpha', permissions: ['read'] }]);
  const cases = [
    [{ q: 'x'.repeat(241) }, 'q', 'length'],
    [{ q: ['a', 'b'] }, 'q', 'type'],
    [{ repositories: 'Alpha' }, 'repositories', 'format'],
    [
      { repositories: Array.from({ length: 101 }, (_, i) => `r${i}`).join(',') },
      'repositories',
      'length',
    ],
    [{ labels: 'a,,b' }, 'labels', 'format'],
    [{ labels: 'a,b,c,d,e,f,g,h,i' }, 'labels', 'length'],
    [{ stage: 'Prod' }, 'stage', 'format'],
    [{ after: 'x' }, 'after', 'format'],
    [{ after: `1.alpha.${ID(1)}.extra` }, 'after', 'format'],
    [{ after: `01.alpha.${ID(1)}` }, 'after', 'format'],
    [{ limit: '0' }, 'limit', 'range'],
    [{ limit: '101' }, 'limit', 'range'],
    [{ limit: '1e2' }, 'limit', 'range'],
  ];
  for (const [input, field, problem] of cases)
    await assert.rejects(search.search(principal, input), (error) => {
      assert.equal(error.code, 'invalid_input', JSON.stringify(input).slice(0, 80));
      assert.deepEqual(error.details, [{ field, problem }]);
      return true;
    });
});

test('the SDK reader checks the global search page against the contract', () => {
  const item = {
    id: ID(1),
    name: 'a',
    size: '1',
    createdAt: '2026-01-01T00:00:00.000Z',
    publishedAt: null,
    labels: [],
    stages: [],
    repository: 'alpha',
  };
  assert.deepEqual(readGlobalSearchPage({ items: [item], next: null }).items, [item]);
  assert.throws(() =>
    readGlobalSearchPage({ items: [{ ...item, repository: 'A/b' }], next: null }),
  );
  assert.throws(() => readGlobalSearchPage({ items: Array(101).fill(item), next: null }));
  assert.throws(() => readGlobalSearchPage({ items: [], next: 'x'.repeat(161) }));
  const operation = openApiDocument.paths['/api/v1/search'].get;
  assert.equal(operation.operationId, 'searchAllRepositories');
  assert.deepEqual(
    operation.parameters.map((p) => p.name),
    ['q', 'repositories', 'labels', 'stage', 'after', 'limit'],
  );
});
