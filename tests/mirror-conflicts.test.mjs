import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONFLICT_RETRY_LIMIT,
  MirrorFailure,
  MirrorSync,
  StageImport,
  conflictCode,
} from '@proanima/arkvory-application';

/*
 * A conflict of one entry puts it aside and the feed goes on (ADR 0058, 2026-10-15); any other
 * failure still stops the step; entries put aside are retried after ten minutes and cleared once
 * they apply or the source no longer offers them.
 */

const never = { throwIfAborted() {} };
const descriptor = { name: 'f', size: 1, sha256: 'a'.repeat(64), labels: [], metadata: {} };
const packageConflict = () => new MirrorFailure('mirror_package_conflict', 'other bytes');
const idTaken = () => new MirrorFailure('mirror_id_taken', 'held by another repository');

function clock() {
  const c = { at: Date.parse('2026-10-15T10:00:00.000Z') };
  c.now = () => new Date(c.at).toISOString();
  c.pass = (minutes) => {
    c.at += minutes * 60_000;
  };
  return c;
}

/** Entries put aside, keyed like the table: artifact, action and detail. */
function conflictStore() {
  const rows = new Map();
  const key = (entry) => `${entry.artifactId}|${entry.action}|${entry.detail ?? ''}`;
  return {
    rows,
    list: () => [...rows.values()],
    setAside: async (_repository, entry, code, at) => {
      const found = rows.get(key(entry));
      const row = found
        ? { ...found, code, lastAt: at, attempts: found.attempts + 1 }
        : { ...entry, code, firstAt: at, lastAt: at, attempts: 1 };
      rows.set(key(entry), row);
      return row.attempts;
    },
    due: async (_repository, before, limit) =>
      [...rows.values()]
        .filter((row) => row.lastAt <= before)
        .sort((a, b) => a.lastAt.localeCompare(b.lastAt))
        .slice(0, limit),
    resolve: async (_repository, entry) => {
      rows.delete(key(entry));
    },
  };
}

function states() {
  const rows = new Map();
  return {
    rows,
    load: async (repository) => rows.get(repository) ?? null,
    save: async (state) => {
      rows.set(state.repository, { ...state });
    },
    reattach: async () => false,
  };
}

/** A source of artifacts and a feed; `head` follows the feed. */
function source(ids = []) {
  const s = { artifacts: new Set(ids), packages: [], feed: [], stages: new Map() };
  const head = () => s.feed.at(-1)?.sequence ?? '0';
  s.port = {
    changes: async (after) => ({
      items: s.feed.filter((item) => BigInt(item.sequence) > BigInt(after)),
      head: head(),
      next: null,
    }),
    artifacts: async () => ({
      items: [...s.artifacts].map((id) => ({ id, descriptor })),
      next: null,
    }),
    packages: async () => ({ items: s.packages, next: null }),
    assets: async () => ({ items: [], next: null }),
    artifact: async (id) => (s.artifacts.has(id) ? { id, descriptor } : null),
    annotation: async (id) =>
      s.artifacts.has(id) ? { labels: [], metadata: {}, collections: [] } : null,
    stages: async (id) => (s.stages.get(id) ?? []).map((stage) => ({ stage, comment: null })),
    staged: async (stage) => ({
      items: [...s.stages].filter(([, list]) => list.includes(stage)).map(([id]) => id),
      next: null,
    }),
    asset: async () => null,
  };
  s.publish = (sequence, action, artifactId, detail = null) => {
    s.feed.push({ sequence, action, artifactId, detail });
  };
  return s;
}

/** A target whose `fail` map makes copy or register of an ID throw. */
function target() {
  const t = { log: [], present: new Set(), fail: new Map() };
  const failing = (step, id) => {
    const error = t.fail.get(`${step} ${id}`);
    if (error) throw error();
  };
  t.port = {
    copy: async (artifact) => {
      failing('copy', artifact.id);
      t.log.push(`copy ${artifact.id}`);
      t.present.add(artifact.id);
      return 0;
    },
    remove: async (id) => {
      t.log.push(`remove ${id}`);
      t.present.delete(id);
    },
    annotate: async () => undefined,
    stages: async () => undefined,
    register: async (id) => {
      failing('register', id);
      t.log.push(`register ${id}`);
    },
    asset: async () => undefined,
    ociBlob: async (digest, id) => t.log.push(`blob ${digest}=${id}`),
    local: async (id) => (t.present.has(id) ? 'present' : 'absent'),
    settled: async () => false,
    addStages: async () => undefined,
    adopt: async (id) => {
      failing('register', id);
      t.log.push(`adopt ${id}`);
    },
  };
  return t;
}

function setup(ids, stages) {
  const s = source(ids);
  // A first entry the synchronization ignores: following starts at sequence 1.
  s.publish('1', 'reference.add', 'noise');
  const t = target();
  const st = states();
  const conflicts = conflictStore();
  const c = clock();
  const dependencies = {
    repository: 'releases',
    source: 'https://a|releases',
    upstream: s.port,
    target: t.port,
    states: st,
    conflicts,
    now: c.now,
  };
  const sync = stages ? new StageImport({ ...dependencies, stages }) : new MirrorSync(dependencies);
  const settle = async () => {
    for (let step = 0; step < 50; step++) if ((await sync.step(never)) === 'idle') return;
    throw new Error('no idle step');
  };
  return { s, t, st, conflicts, c, sync, settle, state: () => st.rows.get('releases') };
}

test('only the two conflict codes are put aside', () => {
  assert.equal(conflictCode(packageConflict()), 'mirror_package_conflict');
  assert.equal(conflictCode(idTaken()), 'mirror_id_taken');
  assert.equal(conflictCode(new MirrorFailure('mirror_mismatch', 'x')), null);
  assert.equal(conflictCode(Object.assign(new Error('x'), { code: 'mirror_id_taken' })), null);
});

test('a conflicting entry is put aside and the feed goes on past it', async () => {
  const m = setup(['a']);
  await m.settle();
  m.s.artifacts.add('b').add('c');
  m.s.publish('2', 'package.register', 'b');
  m.s.publish('3', 'artifact.publish', 'c');
  m.t.fail.set('register b', packageConflict);
  await m.settle();
  assert.equal(m.state().cursor, '3', 'the cursor passed the conflicting entry');
  assert.equal(m.state().errorCode, null, 'a conflict set aside is no stop');
  assert.ok(m.t.log.includes('copy c'), 'the entry after it applied');
  assert.deepEqual(
    m.conflicts.list().map(({ artifactId, action, code, attempts }) => ({
      artifactId,
      action,
      code,
      attempts,
    })),
    [{ artifactId: 'b', action: 'package.register', code: 'mirror_package_conflict', attempts: 1 }],
  );
});

test('any other failure still stops the feed at the entry, nothing is put aside', async () => {
  const m = setup(['a']);
  await m.settle();
  m.s.artifacts.add('b');
  m.s.publish('2', 'artifact.publish', 'b');
  m.t.fail.set('copy b', () => new MirrorFailure('mirror_mismatch', 'other bytes'));
  await assert.rejects(m.sync.step(never), /other bytes/);
  assert.equal(m.state().cursor, '1');
  assert.equal(m.state().errorCode, 'mirror_mismatch');
  m.t.fail.set('copy b', () => Object.assign(new Error('reset'), { code: 'ECONNRESET' }));
  await assert.rejects(m.sync.step(never), /reset/);
  assert.equal(m.state().cursor, '1');
  assert.equal(m.state().errorCode, 'mirror_unreachable');
  assert.equal(m.conflicts.rows.size, 0);
});

test('registry entries are not put aside: their order matters', async () => {
  const m = setup(['a']);
  await m.settle();
  m.s.artifacts.add('b');
  m.s.publish('2', 'oci.blob', 'b', `sha256:${'b'.repeat(64)}`);
  m.t.fail.set('copy b', idTaken);
  await assert.rejects(m.sync.step(never), (error) => error.code === 'mirror_id_taken');
  assert.equal(m.state().cursor, '1');
  assert.equal(m.conflicts.rows.size, 0);
});

test('an entry put aside is retried after ten minutes and cleared once it applies', async () => {
  const m = setup(['a']);
  await m.settle();
  m.s.artifacts.add('b');
  m.s.publish('2', 'package.register', 'b');
  m.t.fail.set('register b', packageConflict);
  await m.settle();
  m.c.pass(5);
  await m.settle();
  assert.equal(m.conflicts.list()[0].attempts, 1, 'not tried again within ten minutes');
  m.c.pass(5);
  await m.settle();
  assert.equal(m.conflicts.list()[0].attempts, 2, 'a conflict again counts one more attempt');
  // The version here was removed: the package registers.
  m.t.fail.delete('register b');
  m.c.pass(10);
  await m.settle();
  assert.equal(m.conflicts.rows.size, 0);
  assert.ok(m.t.log.includes('register b'));
});

test('an entry the source no longer has is cleared by the retry', async () => {
  const m = setup(['a']);
  await m.settle();
  m.s.artifacts.add('b');
  m.s.publish('2', 'artifact.publish', 'b');
  m.t.fail.set('copy b', idTaken);
  await m.settle();
  assert.equal(m.conflicts.rows.size, 1);
  m.s.artifacts.delete('b');
  m.c.pass(10);
  await m.settle();
  assert.equal(m.conflicts.rows.size, 0);
  assert.ok(m.t.log.includes('remove b'), 'gone on the source is gone here (absent is success)');
});

test('a step retries a bounded number of entries; another failure keeps them', async () => {
  const ids = Array.from({ length: CONFLICT_RETRY_LIMIT + 2 }, (_, index) => `x${index}`);
  const m = setup(ids);
  for (const id of ids) m.t.fail.set(`copy ${id}`, idTaken);
  await m.settle();
  assert.equal(m.conflicts.rows.size, ids.length, 'the seed put every one aside and finished');
  assert.equal(m.state().phase, 'following');
  m.c.pass(10);
  await m.sync.step(never);
  const tried = m.conflicts.list().filter((row) => row.attempts === 2);
  assert.equal(tried.length, CONFLICT_RETRY_LIMIT);
  m.c.pass(10);
  m.t.fail.set(`copy ${ids[0]}`, () => new Error('disk failed'));
  await assert.rejects(m.sync.step(never), /disk failed/);
  assert.equal(m.conflicts.rows.size, ids.length, 'a failed retry keeps the entry');
});

test('an import puts a version aside with its stage and goes on; a withdrawn stage clears it', async () => {
  const m = setup([], ['release']);
  await m.settle();
  m.s.artifacts.add('v1').add('v2');
  m.s.stages.set('v1', ['release']);
  m.s.stages.set('v2', ['release']);
  m.s.publish('2', 'stage.add', 'v1', 'release');
  m.s.publish('3', 'stage.add', 'v2', 'release');
  m.t.fail.set('register v1', packageConflict);
  await m.settle();
  assert.equal(m.state().cursor, '3');
  assert.ok(m.t.log.includes('adopt v2'), 'the next version was taken over');
  assert.deepEqual(
    m.conflicts.list().map(({ artifactId, action, detail }) => [artifactId, action, detail]),
    [['v1', 'stage.add', 'release']],
  );
  // The source withdraws the promotion: the retry brings nothing and clears the entry.
  m.s.stages.set('v1', []);
  m.c.pass(10);
  await m.settle();
  assert.equal(m.conflicts.rows.size, 0);
  assert.ok(!m.t.log.includes('adopt v1'));
});
