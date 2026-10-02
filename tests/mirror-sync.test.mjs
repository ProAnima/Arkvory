import test from 'node:test';
import assert from 'node:assert/strict';
import { MirrorFailure, MirrorSync, mirrorErrorCode } from '@proanima/arkvory-application';

const never = { throwIfAborted() {} };
const descriptor = (size = 1) => ({
  name: 'f',
  size,
  sha256: 'a'.repeat(64),
  labels: [],
  metadata: {},
});

/** A source with artifacts, packages, paths and a feed; every read is logged in order. */
function source(initial = {}) {
  const s = {
    log: [],
    artifacts: new Map(
      (initial.artifacts ?? []).map((id) => [id, { id, descriptor: descriptor() }]),
    ),
    packages: initial.packages ?? [],
    assets: initial.assets ?? [],
    feed: initial.feed ?? [],
    head: initial.head ?? '0',
    page: 2,
  };
  const page = (list, after) => {
    const start = after === null ? 0 : Number(after);
    const items = list.slice(start, start + s.page);
    return { items, next: start + s.page < list.length ? String(start + s.page) : null };
  };
  s.port = {
    changes: async (after) => {
      s.log.push(`changes ${after}`);
      const items = s.feed.filter((item) => BigInt(item.sequence) > BigInt(after));
      return { items, head: s.head, next: null };
    },
    artifacts: async (after) => page([...s.artifacts.values()], after),
    packages: async (after) => page(s.packages, after),
    assets: async (after) => page(s.assets, after),
    artifact: async (id) => s.artifacts.get(id) ?? null,
    annotation: async (id) =>
      s.artifacts.has(id) ? { labels: [id], metadata: {}, collections: [] } : null,
    stages: async () => [],
    asset: async (path) => s.assets.find((asset) => asset.path === path) ?? null,
    content: async () => [],
  };
  return s;
}

function target() {
  const t = { log: [], present: new Set() };
  t.port = {
    copy: async (artifact) => {
      t.log.push(`copy ${artifact.id}`);
      if (t.present.has(artifact.id)) return 0;
      t.present.add(artifact.id);
      return artifact.descriptor.size;
    },
    remove: async (id) => {
      t.log.push(`remove ${id}`);
      t.present.delete(id);
    },
    annotate: async (id) => t.log.push(`annotate ${id}`),
    register: async (id) => t.log.push(`register ${id}`),
    stages: async (id) => t.log.push(`stages ${id}`),
    asset: async (asset) => t.log.push(`asset ${asset.path}=${asset.artifactId}`),
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

function mirror(s, t, st, sourceName = 'https://a|releases') {
  return new MirrorSync({
    repository: 'releases',
    source: sourceName,
    upstream: s.port,
    target: t.port,
    states: st,
    now: () => '2026-10-02T00:00:00.000Z',
  });
}

async function settle(sync) {
  for (let step = 0; step < 50; step++) if ((await sync.step(never)) === 'idle') return;
  throw new Error('no idle step');
}

test('the seed takes the head first, then artifacts, packages and paths, then follows from it', async () => {
  const s = source({
    artifacts: ['a', 'b', 'c'],
    packages: ['b'],
    assets: [{ path: 'tools/x', artifactId: 'c' }],
    head: '41',
  });
  const t = target();
  const st = states();
  await settle(mirror(s, t, st));
  assert.equal(s.log[0], 'changes 0', 'the head is read before any listing');
  assert.deepEqual(
    t.log.filter((entry) => !entry.startsWith('annotate') && !entry.startsWith('stages')),
    ['copy a', 'copy b', 'copy c', 'copy b', 'register b', 'copy c', 'asset tools/x=c'],
  );
  const state = st.rows.get('releases');
  assert.equal(state.phase, 'following');
  assert.equal(state.cursor, '41', 'following starts at the head seen before the listing');
  assert.equal(state.copiedArtifacts, 3);
  assert.equal(state.copiedBytes, '3');
  assert.equal(state.syncedAt, '2026-10-02T00:00:00.000Z');
});

test('feed events re-read the source state and move the cursor one event at a time', async () => {
  const s = source({ artifacts: ['a', 'b'], head: '10' });
  const t = target();
  const st = states();
  await settle(mirror(s, t, st));
  t.log.length = 0;
  s.artifacts.set('n', { id: 'n', descriptor: descriptor(5) });
  s.artifacts.delete('b');
  s.assets.push({ path: 'p', artifactId: 'n' });
  s.feed = [
    { sequence: '11', action: 'artifact.publish', artifactId: 'n', detail: null },
    { sequence: '12', action: 'package.register', artifactId: 'n', detail: null },
    { sequence: '13', action: 'asset.replace', artifactId: 'n', detail: 'p' },
    { sequence: '14', action: 'reference.add', artifactId: 'n', detail: null },
    { sequence: '15', action: 'artifact.delete', artifactId: 'b', detail: null },
    // Published and deleted again before the mirror saw it: the re-read finds it gone.
    { sequence: '16', action: 'future.action', artifactId: 'gone', detail: null },
  ];
  s.head = '16';
  await settle(mirror(s, t, st));
  assert.deepEqual(
    t.log.filter((entry) => !entry.startsWith('annotate') && !entry.startsWith('stages')),
    ['copy n', 'copy n', 'register n', 'copy n', 'asset p=n', 'remove b', 'remove gone'],
  );
  assert.equal(st.rows.get('releases').cursor, '16');
});

test('a failed event keeps the cursor before it and records the error code', async () => {
  const s = source({ artifacts: ['a'], head: '1' });
  const t = target();
  const st = states();
  await settle(mirror(s, t, st));
  s.feed = [
    { sequence: '2', action: 'annotations.replace', artifactId: 'a', detail: null },
    { sequence: '3', action: 'annotations.replace', artifactId: 'a', detail: null },
  ];
  s.head = '3';
  let calls = 0;
  t.port.annotate = async () => {
    if (++calls === 2) throw Object.assign(new Error('down'), { code: 'unavailable' });
  };
  const sync = mirror(s, t, st);
  await assert.rejects(sync.step(never), /down/);
  const failed = st.rows.get('releases');
  assert.equal(failed.cursor, '2', 'the applied event stays applied');
  assert.equal(failed.errorCode, 'unavailable');
  await settle(sync);
  assert.equal(st.rows.get('releases').errorCode, null, 'catching up clears the error');
  // A stop is not a failure of the source.
  const stopped = {
    throwIfAborted: () => {
      throw new Error('stopped');
    },
  };
  s.feed.push({ sequence: '4', action: 'annotations.replace', artifactId: 'a', detail: null });
  s.head = '4';
  t.port.annotate = async () => {
    throw new Error('interrupted');
  };
  await assert.rejects(sync.step(stopped));
  assert.equal(st.rows.get('releases').errorCode, null);
});

test('a state of another source is never continued', async () => {
  const st = states();
  await settle(mirror(source({ artifacts: ['a'], head: '1' }), target(), st));
  await assert.rejects(
    mirror(source(), target(), st, 'https://b|releases').step(never),
    (error) => error instanceof MirrorFailure && error.code === 'mirror_source_changed',
  );
  assert.equal(mirrorErrorCode(new Error('plain')), 'mirror_failed');
  assert.equal(mirrorErrorCode({ code: 'Bad Code' }), 'mirror_failed');
  assert.equal(mirrorErrorCode({ code: 'not_found' }), 'not_found');
});
