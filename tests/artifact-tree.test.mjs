import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ArkvoryError, treeIndexable, treePathKey } from '@proanima/arkvory-domain';
import { ArtifactTrees, TreeIndexer, treeRetryMs } from '@proanima/arkvory-application';

const running = { throwIfAborted() {} };
const digest = 'a'.repeat(64);

function entry(ordinal) {
  return {
    ordinal,
    path: `file-${String(ordinal)}.txt`,
    size: ordinal,
    sha256: digest,
    method: 'stored',
    dataOffset: 30 + ordinal,
    dataLength: ordinal,
  };
}

/** An artifact lookup and a stored index; `artifact` throws like StorageService for others. */
function trees({ name = 'tree.zip', state, count = 0, artifact } = {}) {
  const calls = [];
  const storage = {
    async artifact(principal, repository, id, permission) {
      calls.push(permission);
      if (artifact) return artifact(principal, repository, id);
      return { id, repository, descriptor: { name, sha256: digest, size: 1 }, status: 'available' };
    },
  };
  const index = {
    async state() {
      return state;
    },
    async entries(_id, after, limit) {
      const rows = [];
      for (let ordinal = after + 1; ordinal < count && rows.length < limit; ordinal++)
        rows.push(entry(ordinal));
      return rows;
    },
  };
  return { service: new ArtifactTrees(storage, index), calls };
}

const principal = { id: 'reader', repositories: ['releases'], permissions: ['read'] };

test('archives are recognised by name and paths compared as every client would', () => {
  for (const name of ['a.zip', 'B.ZIP', 'pkg-1.0.upack', 'x.UPack']) assert.ok(treeIndexable(name));
  for (const name of ['a.zip.bin', 'zip', 'a.tar', 'a.jar', '.zipx'])
    assert.ok(!treeIndexable(name));
  assert.equal(treePathKey('Docs/CafÉ.TXT'), treePathKey('docs/café.txt'));
  assert.notEqual(treePathKey('a/b'), treePathKey('a/c'));
});

test('a page is read with content.read; pending, not_archive and unavailable carry no items', async () => {
  const pending = trees();
  assert.deepEqual(await pending.service.page(principal, 'releases', randomUUID(), undefined), {
    status: 'pending',
    reason: null,
    archiveSha256: digest,
    entries: null,
    items: [],
    next: null,
  });
  assert.deepEqual(pending.calls, ['content.read']);
  const binary = await trees({ name: 'tool.bin' }).service.page(
    principal,
    'releases',
    randomUUID(),
  );
  assert.deepEqual([binary.status, binary.reason], ['unavailable', 'not_archive']);
  const refused = await trees({
    state: { status: 'unavailable', reason: 'unsafe_entry', entries: null },
  }).service.page(principal, 'releases', randomUUID());
  assert.deepEqual(
    [refused.status, refused.reason, refused.items],
    ['unavailable', 'unsafe_entry', []],
  );
  // A missing or forbidden artifact fails exactly as its lookup does.
  const hidden = trees({
    artifact: () => {
      throw new ArkvoryError('not_found', 'Artifact not found');
    },
  });
  await assert.rejects(hidden.service.page(principal, 'releases', randomUUID()), {
    code: 'not_found',
  });
});

test('ready pages follow the ordinal cursor and end with next null', async () => {
  const { service } = trees({ state: { status: 'ready', reason: null, entries: 5 }, count: 5 });
  const first = await service.page(principal, 'releases', randomUUID(), undefined, 2);
  assert.deepEqual(
    [first.status, first.entries, first.items.map((e) => e.ordinal), first.next],
    ['ready', 5, [0, 1], 1],
  );
  const second = await service.page(principal, 'releases', randomUUID(), first.next, 2);
  assert.deepEqual([second.items.map((e) => e.ordinal), second.next], [[2, 3], 3]);
  const last = await service.page(principal, 'releases', randomUUID(), second.next, 2);
  assert.deepEqual([last.items.map((e) => e.ordinal), last.next], [[4], null]);
  const exact = await service.page(principal, 'releases', randomUUID(), 2, 2);
  assert.deepEqual([exact.items.map((e) => e.ordinal), exact.next], [[3, 4], null]);
  const beyond = await service.page(principal, 'releases', randomUUID(), 999_999_999, 2);
  assert.deepEqual([beyond.items, beyond.next], [[], null]);
  const empty = trees({ state: { status: 'ready', reason: null, entries: 0 } });
  const none = await empty.service.page(principal, 'releases', randomUUID());
  assert.deepEqual([none.status, none.entries, none.items, none.next], ['ready', 0, [], null]);
  for (const [after, limit] of [
    [-1, 10],
    [0.5, 10],
    [undefined, 0],
    [undefined, 1001],
  ])
    await assert.rejects(service.page(principal, 'releases', randomUUID(), after, limit), {
      code: 'invalid_input',
    });
});

/** A queue over ids, a builder answering from `results`, and a store that records saves. */
function indexer(results, { now = () => 0, batch = 10 } = {}) {
  const asked = [];
  const saved = [];
  const queue = {
    async pending(limit, skip) {
      asked.push(skip);
      return Object.keys(results)
        .filter((id) => !skip.includes(id) && !saved.some((s) => s.id === id))
        .slice(0, limit)
        .map((id) => ({ id, repository: 'releases', size: 1 }));
    },
  };
  const builder = {
    async build(candidate) {
      const result = results[candidate.id];
      if (result instanceof Error) throw result;
      return typeof result === 'function' ? result() : result;
    },
  };
  const store = {
    async save(id, tree) {
      if (results[id] === 'raced') return false;
      saved.push({ id, tree });
      return true;
    },
  };
  return { indexer: new TreeIndexer(queue, builder, store, now, batch), asked, saved };
}

test('a pass stores outcomes, reports each one and backs off a failing archive', async () => {
  let clock = 0;
  const failure = new ArkvoryError('unavailable', 'Storage is down');
  const {
    indexer: worker,
    asked,
    saved,
  } = indexer(
    {
      good: { status: 'ready', entries: [entry(0), entry(1)] },
      bad: { status: 'unavailable', reason: 'not_archive' },
      down: failure,
    },
    { now: () => clock },
  );
  const reported = [];
  const outcomes = await worker.pass(running, (outcome) => reported.push(outcome));
  assert.deepEqual(outcomes, reported);
  assert.deepEqual(outcomes, [
    { kind: 'ready', id: 'good', entries: 2 },
    { kind: 'unavailable', id: 'bad', reason: 'not_archive' },
    { kind: 'failed', id: 'down', errorCode: 'unavailable', attempts: 1, retryInMs: 30_000 },
  ]);
  assert.deepEqual(
    saved.map((s) => s.id),
    ['good', 'bad'],
  );
  // Left out until its pause is over, then tried again with a doubled pause.
  assert.deepEqual(await worker.pass(running), []);
  assert.deepEqual(asked[1], ['down']);
  clock = 30_000;
  const retried = await worker.pass(running);
  assert.deepEqual(retried, [
    { kind: 'failed', id: 'down', errorCode: 'unavailable', attempts: 2, retryInMs: 60_000 },
  ]);
  assert.equal(treeRetryMs(1), 30_000);
  assert.equal(treeRetryMs(8), 3_600_000);
  assert.equal(treeRetryMs(100), 3_600_000);
});

test('a raced save is skipped, a pass takes at most its batch and a stop is not a failure', async () => {
  const { indexer: raced } = indexer({ x: 'raced' });
  // The builder answers the marker itself; the store refuses it as another pass's row.
  assert.deepEqual(await raced.pass(running), [{ kind: 'skipped', id: 'x' }]);
  const results = Object.fromEntries(
    Array.from({ length: 5 }, (_, i) => [`a${String(i)}`, { status: 'ready', entries: [] }]),
  );
  const { indexer: small } = indexer(results, { batch: 2 });
  assert.equal((await small.pass(running)).length, 2);
  const stop = new AbortController();
  stop.abort();
  const before = indexer({ y: { status: 'ready', entries: [] } });
  await assert.rejects(before.indexer.pass(stop.signal), { name: 'AbortError' });
  assert.equal(before.saved.length, 0);
  // A build cut short by the stop rethrows instead of backing the archive off.
  const state = { stopped: false };
  const cancellation = {
    throwIfAborted() {
      if (state.stopped) throw new ArkvoryError('unavailable', 'Stopped');
    },
  };
  const cut = indexer({
    z: () => {
      state.stopped = true;
      throw new ArkvoryError('unavailable', 'Read cut short');
    },
  });
  await assert.rejects(cut.indexer.pass(cancellation), { message: 'Read cut short' });
  state.stopped = false;
  assert.deepEqual(cut.asked, [[]]);
  await assert.rejects(cut.indexer.pass(cancellation), { message: 'Read cut short' });
  assert.deepEqual(cut.asked, [[], []], 'not remembered as failing');
});
