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
    ociBlob: async (digest, id) => t.log.push(`blob ${digest}=${id}`),
    ociManifest: async (image, id, tag) => t.log.push(`manifest ${image} ${id} ${tag}`),
    ociUntag: async (image, tag) => t.log.push(`untag ${image}:${tag}`),
    ociForget: async (image, digest) => t.log.push(`forget ${image}@${digest}`),
    lfsObject: async (oid, id) => t.log.push(`lfs ${oid}=${id}`),
    npmVersion: async (id) => t.log.push(`npm ${id}`),
    npmTag: async (name, tag, version) => t.log.push(`npm-tag ${name}@${tag}=${version}`),
    npmUntag: async (name, tag) => t.log.push(`npm-untag ${name}@${tag}`),
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
  // The refusal shows in the status; the stored source and cursor stay those of the first one.
  const kept = st.rows.get('releases');
  assert.equal(kept.errorCode, 'mirror_source_changed');
  assert.equal(kept.source, 'https://a|releases');
  assert.equal(kept.cursor, '1');
  assert.equal(mirrorErrorCode(new Error('plain')), 'mirror_failed');
  assert.equal(mirrorErrorCode({ code: 'Bad Code' }), 'mirror_failed');
  assert.equal(mirrorErrorCode({ code: 'not_found' }), 'not_found');
});

test('another stage list of the same source seeds again and keeps the copy counters', async () => {
  const st = states();
  await settle(mirror(source({ artifacts: ['a'], head: '3' }), target(), st));
  const t = target();
  await settle(mirror(source({ artifacts: ['a'], head: '3' }), t, st, 'https://a|releases|x'));
  const state = st.rows.get('releases');
  assert.equal(state.source, 'https://a|releases|x');
  assert.equal(state.phase, 'following');
  assert.equal(state.copiedArtifacts, 2, 'counted again only for what the new seed copied');
  assert.ok(t.log.includes('copy a'), 'the new seed re-read the source');
});

test('a source restored behind the cursor is seeded again, and the status says why', async () => {
  const st = states();
  const s = source({ artifacts: ['a'], head: '9' });
  await settle(mirror(s, target(), st));
  assert.equal(st.rows.get('releases').cursor, '9');
  s.head = '4';
  const sync = mirror(s, target(), st);
  assert.equal(await sync.step(never), 'progress');
  const reseeded = st.rows.get('releases');
  assert.equal(reseeded.phase, 'seeding');
  assert.equal(reseeded.errorCode, 'mirror_source_behind');
  await settle(sync);
  const done = st.rows.get('releases');
  assert.equal(done.cursor, '4');
  assert.equal(done.errorCode, null, 'cleared once the mirror has caught up again');
});

const digest = (c) => `sha256:${c.repeat(64)}`;
const entry = (sequence, action, artifactId, detail = null) => ({
  sequence,
  action,
  artifactId,
  detail,
});

test('after the seed, registry entries below its head are replayed in order, others skipped', async () => {
  const feed = [
    entry('1', 'artifact.publish', 'l'),
    entry('2', 'oci.blob', 'l', digest('1')),
    entry('3', 'artifact.publish', 'm'),
    entry('4', 'oci.manifest', 'm', `team/web@${digest('2')}`),
    entry('5', 'oci.tag', 'm', 'team/web:1.0'),
    entry('6', 'oci.tag', 'm', 'team/web:old'),
    entry('7', 'oci.tag.delete', 'm', 'team/web:old'),
    entry('8', 'oci.blob', 'gone', digest('3')),
    entry('9', 'lfs.object', 'l', '4'.repeat(64)),
  ];
  const s = source({ artifacts: ['l', 'm'], head: '9', feed });
  const t = target();
  const st = states();
  await settle(mirror(s, t, st));
  const registry = t.log.filter((line) => /^(blob|manifest|untag|forget|lfs) /.test(line));
  assert.deepEqual(registry, [
    `blob ${digest('1')}=l`,
    'manifest team/web m null',
    'manifest team/web m 1.0',
    'manifest team/web m old',
    'untag team/web:old',
    `lfs ${'4'.repeat(64)}=l`,
  ]);
  assert.ok(t.log.includes('remove gone'), 'content gone on the source is not recorded');
  assert.equal(st.rows.get('releases').cursor, '9');

  // Following: every entry applies; a deleted manifest is forgotten, a bad detail only refreshes.
  t.log.length = 0;
  s.feed.push(
    entry('10', 'oci.manifest.delete', 'm', `team/web@${digest('2')}`),
    entry('11', 'oci.tag', 'm', 'no-separator'),
    entry('12', 'oci.newer', 'l'),
  );
  s.head = '12';
  await settle(mirror(s, t, st));
  assert.deepEqual(
    t.log.filter((line) => !line.startsWith('annotate') && !line.startsWith('stages')),
    [`forget team/web@${digest('2')}`, 'copy m', 'copy l'],
  );

  // npm versions come from the copied tarball; tags follow by name; bad details are skipped.
  t.log.length = 0;
  const npm = (detail) => JSON.stringify({ name: 'com.example.tools', ...detail });
  s.feed.push(
    entry('13', 'npm.version', 'l', npm({ version: '1.0.0' })),
    entry('14', 'npm.tag', 'l', npm({ tag: 'latest', version: '1.0.0' })),
    entry('15', 'npm.tag.delete', 'l', npm({ tag: 'beta' })),
    entry('16', 'npm.tag', 'l', '{"name":"Bad Name","tag":"latest","version":"1.0.0"}'),
    entry('17', 'npm.version', 'gone', npm({ version: '2.0.0' })),
  );
  s.head = '17';
  await settle(mirror(s, t, st));
  assert.deepEqual(
    t.log.filter((line) => line.startsWith('npm')),
    ['npm l', 'npm-tag com.example.tools@latest=1.0.0', 'npm-untag com.example.tools@beta'],
  );
});
