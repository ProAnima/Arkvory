import test from 'node:test';
import assert from 'node:assert/strict';
import { StageImport } from '@proanima/arkvory-application';

const never = { throwIfAborted() {} };
const descriptor = { name: 'f', size: 2, sha256: 'a'.repeat(64), labels: [], metadata: {} };

/** A source whose artifacts carry stages; only reads that an import needs are offered. */
function source() {
  const s = { stages: new Map(), artifacts: new Set(), feed: [], head: '5', reads: [] };
  const staged = (stage) =>
    [...s.stages].filter(([, list]) => list.includes(stage)).map(([id]) => id);
  s.port = {
    changes: async (after) => ({
      items: s.feed.filter((item) => BigInt(item.sequence) > BigInt(after)),
      head: s.head,
      next: null,
    }),
    staged: async (stage, after) => {
      s.reads.push(`staged ${stage} ${String(after)}`);
      const list = staged(stage);
      return after === null && list.length > 1
        ? { items: list.slice(0, 1), next: 'p2' }
        : { items: after === null ? list : list.slice(1), next: null };
    },
    artifact: async (id) => (s.artifacts.has(id) ? { id, descriptor } : null),
    annotation: async (id) => ({ labels: [id], metadata: {}, collections: [] }),
    stages: async (id) => (s.stages.get(id) ?? []).map((stage) => ({ stage, comment: null })),
  };
  s.add = (id, ...stages) => {
    s.artifacts.add(id);
    s.stages.set(id, stages);
  };
  return s;
}

function target() {
  const t = { local: new Map(), log: [] };
  t.port = {
    local: async (id) => t.local.get(id) ?? 'absent',
    copy: async (artifact) => {
      t.log.push(`copy ${artifact.id}`);
      t.local.set(artifact.id, 'present');
      return 2;
    },
    adopt: async (id, annotation, stages) =>
      t.log.push(`adopt ${id} ${annotation.labels.join()} ${stages.map((s) => s.stage).join()}`),
  };
  return t;
}

function states() {
  const rows = new Map();
  return {
    rows,
    load: async (repository) => rows.get(repository) ?? null,
    save: async (state) => {
      rows.set(state.repository, { ...state });
    },
  };
}

const importer = (s, t, st, stages = ['release'], source = 'https://dev|builds|release') =>
  new StageImport({
    repository: 'prod',
    source,
    upstream: s.port,
    target: t.port,
    states: st,
    stages,
    now: () => '2026-10-02T00:00:00.000Z',
  });

async function settle(sync) {
  for (let step = 0; step < 50; step++) if ((await sync.step(never)) === 'idle') return;
  throw new Error('no idle step');
}

test('the seed takes over the versions of each configured stage and nothing else', async () => {
  const s = source();
  s.add('a', 'release');
  s.add('b', 'qa');
  s.add('c', 'release', 'qa');
  s.add('d', 'hotfix');
  const t = target();
  const st = states();
  await settle(importer(s, t, st, ['release', 'hotfix']));
  assert.deepEqual(t.log, [
    'copy a',
    'adopt a a release',
    'copy c',
    'adopt c c release',
    'copy d',
    'adopt d d hotfix',
  ]);
  assert.deepEqual(s.reads, ['staged release null', 'staged release p2', 'staged hotfix null']);
  const state = st.rows.get('prod');
  assert.equal(state.phase, 'following');
  assert.equal(state.cursor, '5');
  assert.equal(state.copiedArtifacts, 3);
});

test('only a configured stage brings a version; deletions never reach the import', async () => {
  const s = source();
  s.add('a', 'release');
  const t = target();
  const st = states();
  await settle(importer(s, t, st));
  t.log.length = 0;
  s.add('n', 'release');
  s.add('q', 'qa');
  s.artifacts.delete('a');
  t.local.set('gone', 'deleted');
  s.add('gone', 'release');
  s.feed = [
    { sequence: '6', action: 'stage.add', artifactId: 'q', detail: 'qa' },
    { sequence: '7', action: 'stage.add', artifactId: 'n', detail: 'release' },
    { sequence: '8', action: 'artifact.delete', artifactId: 'a', detail: null },
    // Deleted here: never imported again, whatever the source does.
    { sequence: '9', action: 'stage.add', artifactId: 'gone', detail: 'release' },
    // Present already: completed again (repeatable), not copied again.
    { sequence: '10', action: 'stage.add', artifactId: 'n', detail: 'release' },
  ];
  s.head = '10';
  await settle(importer(s, t, st));
  assert.deepEqual(t.log, ['copy n', 'adopt n n release', 'adopt n n release']);
  assert.equal(t.local.get('a'), 'present', 'the deletion on the source did not reach the import');
  assert.equal(st.rows.get('prod').cursor, '10');
});

test('a stage removed before the import ran brings nothing; other stages seed again', async () => {
  const s = source();
  const t = target();
  const st = states();
  await settle(importer(s, t, st));
  s.add('late', 'qa');
  s.feed = [{ sequence: '6', action: 'stage.add', artifactId: 'late', detail: 'release' }];
  s.head = '6';
  await settle(importer(s, t, st));
  assert.deepEqual(t.log, [], 'the stage was gone when the import looked');
  // A new filter starts over from a seed: importing is idempotent and never deletes.
  s.add('old', 'qa');
  await settle(importer(s, t, st, ['qa'], 'https://dev|builds|qa'));
  assert.deepEqual(t.log, ['copy late', 'adopt late late qa', 'copy old', 'adopt old old qa']);
  assert.equal(st.rows.get('prod').source, 'https://dev|builds|qa');
});
