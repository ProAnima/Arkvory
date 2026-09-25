import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { ZipFile } from 'yazl';
import { parseRelease, updateDecision, newer } from '../apps/deploy/dist/model.js';
import { applyUpdate } from '../apps/deploy/dist/update.js';
import { atomicJson, exclusive } from '../apps/deploy/dist/files.js';
import { archivePath, extractArchive } from '../apps/deploy/dist/archive.js';
import { GitHubReleases } from '../apps/deploy/dist/github.js';
import { runtimeEnvironment } from '../apps/deploy/dist/runtime.js';
import { parse } from 'yaml';

const previous = {
  format: 1,
  version: '1.0.0',
  commit: 'a'.repeat(40),
  schema: 15,
  archiveSha256: 'a'.repeat(64),
  setupSha256: 'b'.repeat(64),
};
const next = { ...previous, version: '1.1.0', archiveSha256: 'c'.repeat(64) };
const state = {
  format: 1,
  mode: 'systemd',
  engine: 'docker',
  automatic: true,
  pin: null,
  current: previous,
};
function port(fail = '') {
  const events = [];
  let healthCalls = 0;
  let saved = state;
  return {
    events,
    get saved() {
      return saved;
    },
    stage: async () => {
      events.push('stage');
      if (fail === 'stage') throw Error('download failed');
    },
    stop: async () => {
      events.push('stop');
    },
    start: async (release) => {
      events.push('start:' + release.version);
    },
    healthy: async () => {
      events.push('health');
      healthCalls++;
      if (fail === 'always' || (fail === 'health' && healthCalls === 1)) throw Error('unhealthy');
    },
    save: async (value) => {
      saved = value;
      events.push('save:' + value.current.version);
    },
    journal: async (value) => {
      events.push(value.phase);
    },
  };
}
test('release policy rejects unstable versions, replaced assets, downgrades and schema changes', () => {
  for (const version of ['1.2.3-rc.1', 'v1.2.3', '01.2.3', '../1', '1000000.0.0'])
    assert.throws(() => parseRelease({ ...previous, version }));
  assert.equal(newer('1.10.0', '1.9.9'), true);
  assert.throws(
    () => updateDecision(state, { ...previous, archiveSha256: next.archiveSha256 }, false),
    /replaced/,
  );
  assert.throws(() => updateDecision(state, { ...next, version: '0.9.0' }, false), /Downgrade/);
  assert.throws(() => updateDecision(state, { ...next, schema: 16 }, true), /Schema/);
});
test('scheduled update honors disabled and pinned installations', async () => {
  for (const change of [{ automatic: false }, { pin: '1.0.0' }]) {
    const fake = port();
    assert.equal(await applyUpdate({ ...state, ...change }, next, true, fake), false);
    assert.deepEqual(fake.events, []);
  }
});
test('successful update verifies before downtime and commits only after health', async () => {
  const fake = port();
  assert.equal(await applyUpdate(state, next, true, fake), true);
  assert.deepEqual(fake.events, [
    'stage',
    'prepared',
    'stop',
    'stopped',
    'save:1.1.0',
    'start:1.1.0',
    'health',
    'committed',
  ]);
});
test('failed download never stops a running installation', async () => {
  const fake = port('stage');
  await assert.rejects(applyUpdate(state, next, true, fake), /download/);
  assert.deepEqual(fake.events, ['stage']);
});
test('failed readiness restores old pointer and running version', async () => {
  const fake = port('health');
  await assert.rejects(applyUpdate(state, next, true, fake), /previous release restored/);
  assert.equal(fake.saved.current.version, '1.0.0');
  assert.deepEqual(fake.events.slice(-6), [
    'rolling-back',
    'stop',
    'save:1.0.0',
    'start:1.0.0',
    'health',
    'rolled-back',
  ]);
});
test('failed rollback retains recovery-required journal instead of reporting success', async () => {
  const fake = port('always');
  await assert.rejects(applyUpdate(state, next, true, fake), /rollback failed/);
  assert.equal(fake.events.at(-1), 'recovery-required');
});
test('filesystem lock rejects a concurrent writer and preserves configuration atomically', async () => {
  const root = await mkdtemp(join(tmpdir(), 'depot-lock-'));
  await exclusive(root, async () => {
    await assert.rejects(
      exclusive(root, async () => {}),
      /locked/,
    );
    await atomicJson(join(root, 'state.json'), state);
    await atomicJson(join(root, 'state.json'), { ...state, current: next });
  });
  assert.equal(
    JSON.parse(await readFile(join(root, 'state.json'), 'utf8')).current.version,
    '1.1.0',
  );
  await exclusive(root, async () => {});
});
test('release archive rejects traversal, links and Windows alternate streams on every OS', () => {
  for (const path of [
    '../escape',
    '/escape',
    'a/../../b',
    'a\\b',
    'a:stream',
    'CON.txt',
    'a/nul',
    'a./b',
    'a/./b',
    'a\0b',
  ])
    assert.throws(() => archivePath('/release', path, 0));
  assert.throws(() => archivePath('/release', 'link', 0o120777 * 65536), /special/);
});
test('extractor refuses existing destinations and duplicate archive files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'depot-zip-'));
  const archive = join(root, 'archive.zip');
  const zip = new ZipFile();
  zip.addBuffer(Buffer.from('first'), 'file');
  zip.addBuffer(Buffer.from('second'), 'file');
  const completed = pipeline(zip.outputStream, createWriteStream(archive));
  zip.end();
  await completed;
  await assert.rejects(extractArchive(archive, root), /EEXIST/);
  await assert.rejects(extractArchive(archive, join(root, 'new')), /EEXIST/);
  assert.equal(await readFile(join(root, 'new/file'), 'utf8'), 'first');
});
test('private GitHub asset redirect strips authorization and verifies checksum', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'depot-download-'));
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls++;
    if (calls === 1) {
      assert.equal(options.headers.Authorization, 'Bearer private-token');
      return new Response(null, {
        status: 302,
        headers: { location: 'https://release-assets.githubusercontent.com/file' },
      });
    }
    assert.equal(new URL(url).host, 'release-assets.githubusercontent.com');
    assert.equal(options.headers.Authorization, undefined);
    return new Response('tampered');
  });
  await assert.rejects(
    new GitHubReleases('private-token').download(
      'https://api.github.com/test',
      join(root, 'bad.zip'),
      '0'.repeat(64),
    ),
    /checksum/,
  );
  await assert.rejects(lstat(join(root, 'bad.zip')), /ENOENT/);
});
test('runtime configuration cannot inject Node process options or multiline values', () => {
  assert.throws(() => runtimeEnvironment({ NODE_OPTIONS: '--inspect=0.0.0.0' }), /Invalid/);
  assert.throws(() => runtimeEnvironment({ DEPOT_HOST: 'x\nDEPOT_KEYS_FILE=x' }), /Invalid/);
});
test('Compose runtime keeps tmpfs options in one mount and persists data separately', async () => {
  const compose = parse(await readFile('deploy/compose.yml', 'utf8'));
  assert.deepEqual(compose.services.api.tmpfs, ['/tmp:size=64m,mode=1777']);
  assert.equal(compose.services.api.read_only, true);
  assert.equal(compose.services.api.restart, 'unless-stopped');
  assert.ok(compose.services.api.volumes.includes('storage:/var/lib/depot'));
  assert.deepEqual(compose.services.api.ports, ['127.0.0.1:8080:8080']);
});
test('stale lock fails closed without taking ownership from another updater', async () => {
  const root = await mkdtemp(join(tmpdir(), 'depot-stale-'));
  await writeFile(join(root, 'operation.lock'), 'interrupted');
  await assert.rejects(
    exclusive(root, async () => {}),
    /inspect journal/,
  );
  assert.equal(await readFile(join(root, 'operation.lock'), 'utf8'), 'interrupted');
});
test('release publishing stays manual, trusted-main-only and behind all release gates', async () => {
  const workflow = parse(await readFile('.github/workflows/release.yml', 'utf8'));
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  assert.equal(workflow.jobs.release.if, "github.ref == 'refs/heads/main'");
  const steps = workflow.jobs.release.steps;
  const gate = steps.findIndex((step) => step.run === 'npm run gate -- release');
  const publish = steps.findIndex((step) => step.run === 'node scripts/publish-release.mjs');
  assert.ok(gate >= 0 && publish > gate);
  assert.ok(steps.every((step) => !step['continue-on-error']));
  const publisher = await readFile('scripts/publish-release.mjs', 'utf8');
  assert.ok(publisher.includes('draft: true'));
  assert.ok(publisher.includes('run.head_sha === sha'));
});
