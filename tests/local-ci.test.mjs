import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { lanes, notExecuted, planLanes, uncoveredGates } from '../scripts/ci/lanes.mjs';
import { laneResult, renderMarkdown, summarize } from '../scripts/ci/evidence.mjs';
import { newerThan, parseVersion, releaseNotes } from '../scripts/ci/github-release.mjs';
import { parseArguments as localArguments } from '../scripts/ci/local.mjs';
import { parseArguments as releaseArguments } from '../scripts/ci/release-local.mjs';
import { disposableHost } from './deployment/disposable-host.mjs';

const registry = JSON.parse(await readFile('config/gates.json', 'utf8'));
const commit = 'a'.repeat(40);
const report = (tasks, extra = {}) => ({
  commit,
  status: tasks.every((task) => task.status === 'passed') ? 'passed' : 'failed',
  dirty: false,
  tasks,
  ...extra,
});
const passed = (...names) => names.map((name) => ({ name, status: 'passed' }));
const host = { os: 'Windows_NT 10', node: 'v24', docker: '29' };

test('every required gate runs in a local lane or is declared not executed', () => {
  assert.deepEqual(uncoveredGates(registry, 'verify'), []);
  assert.deepEqual(uncoveredGates(registry, 'release'), []);
  // Real gaps: service installs on Windows, Compose on a Linux host and the NAS stand, whose
  // SMB/NFS mounts need kernel modules a gate never loads on a workstation; the rest is covered.
  assert.deepEqual(
    notExecuted
      .filter((entry) => entry.kind === 'gap')
      .map((entry) => `${entry.gate}:${entry.platform}`),
    [
      'deployment-services:win32',
      'native-install:win32',
      'deployment-nas:win32',
      'deployment-nas:linux',
      'deployment-containers:linux',
    ],
  );
  assert.ok(notExecuted.every((entry) => entry.reason.length > 10));
});

test('a new merge gate without a lane or declaration is reported as uncovered', () => {
  const extended = { ...registry, mergeTasks: [...registry.mergeTasks, 'future-gate'] };
  assert.deepEqual(uncoveredGates(extended, 'verify'), [
    'future-gate on win32',
    'future-gate on linux',
  ]);
});

test('lane plans follow the profile and reject unknown names', () => {
  const verify = planLanes('verify');
  assert.deepEqual(
    verify.map((lane) => lane.name),
    Object.keys(lanes),
  );
  assert.ok(!verify[0].gates.includes('large-full'));
  assert.ok(planLanes('release', ['windows'])[0].gates.includes('large-multipart'));
  assert.throws(() => planLanes('nightly'), /Unknown local CI profile/);
  assert.throws(() => planLanes('verify', ['macos']), /Unknown local CI lane/);
});

test('a lane passes only with every planned gate passed for the expected commit', () => {
  const lane = {
    name: 'linux',
    environment: 'linux-container',
    platform: 'linux',
    gates: ['unit'],
  };
  assert.equal(
    laneResult(lane, [report(passed('build', 'unit'))], undefined, commit).status,
    'passed',
  );
  const missing = laneResult(lane, [report(passed('build'))], undefined, commit);
  assert.deepEqual([missing.status, missing.missing], ['failed', ['unit']]);
  const foreign = laneResult(lane, [report(passed('unit'))], undefined, 'b'.repeat(40));
  assert.equal(foreign.status, 'failed', 'A report for another commit is not evidence');
  assert.equal(laneResult(lane, [], undefined, commit).status, 'failed');
  const crashed = laneResult(
    lane,
    [report(passed('unit'))],
    new Error('docker\nexec failed'),
    commit,
  );
  assert.deepEqual([crashed.status, crashed.error], ['failed', 'docker exec failed']);
  const dirty = laneResult(lane, [report(passed('unit'), { dirty: true })], undefined, commit);
  assert.deepEqual([dirty.status, dirty.dirty], ['passed', true]);
});

test('only clean, complete release-profile evidence is releasable', () => {
  const all = Object.keys(lanes).map((name) => ({ name, status: 'passed', planned: [] }));
  const base = { profile: 'release', commit, dirty: false, host, lanes: all };
  assert.equal(summarize(base).releasable, true);
  assert.equal(summarize({ ...base, profile: 'verify' }).releasable, false);
  assert.equal(summarize({ ...base, dirty: true }).releasable, false);
  assert.equal(summarize({ ...base, lanes: all.slice(1) }).releasable, false);
  const failed = summarize({ ...base, lanes: [{ ...all[0], status: 'failed' }, ...all.slice(1)] });
  assert.deepEqual([failed.status, failed.releasable], ['failed', false]);
  const text = renderMarkdown(summarize(base));
  assert.match(text, /PASSED/);
  assert.match(text, /deployment-services \(win32\)/);
});

test('release versions are stable and strictly newer than published releases', () => {
  assert.deepEqual(parseVersion('1.20.3'), [1, 20, 3]);
  for (const invalid of ['v1.0.0', '1.0', '1.0.0-rc.1', '01.0.0', ''])
    assert.throws(() => parseVersion(invalid), /stable x\.y\.z/);
  assert.equal(newerThan('1.2.0', ['v1.1.9', 'v0.9.0', 'nightly']), true);
  assert.equal(newerThan('1.2.0', ['v1.2.0']), false);
  assert.equal(newerThan('1.2.0', ['v1.10.0']), false);
  assert.equal(newerThan('2.0.0', ['v1.99.99']), true);
});

test('release notes list local gaps next to both evidence runs', () => {
  const evidence = summarize({ profile: 'release', commit, dirty: false, host, lanes: [] });
  const notes = releaseNotes('1.0.0', evidence, evidence);
  assert.match(notes, /local CI/);
  assert.match(notes, /Candidate acceptance/);
  assert.match(notes, /native-install \(win32\)/);
});

test('command arguments are parsed strictly', () => {
  assert.deepEqual(localArguments(['release', '--lane', 'linux,linux-system']), {
    profile: 'release',
    allowDirty: false,
    keep: false,
    laneNames: ['linux', 'linux-system'],
  });
  assert.throws(() => localArguments(['--force']), /Unknown argument/);
  assert.deepEqual(releaseArguments(['1.0.0', '--dry-run']), {
    dryRun: true,
    reuse: false,
    version: '1.0.0',
  });
  assert.throws(() => releaseArguments([]), /Usage/);
  assert.throws(() => releaseArguments(['1.0.0', '2.0.0']), /Unknown argument/);
});

test('service gates accept only GitHub runners or the local CI container', () => {
  const none = () => false;
  const docker = (path) => path === '/.dockerenv';
  assert.equal(disposableHost({ GITHUB_ACTIONS: 'true' }, 'win32', none), 'github-actions');
  const local = { ARKVORY_DISPOSABLE_HOST: 'container' };
  assert.equal(disposableHost(local, 'linux', docker), 'local-ci-container');
  assert.equal(disposableHost(local, 'linux', none), null, 'A workstation variable is not enough');
  assert.equal(disposableHost(local, 'win32', docker), null);
  assert.equal(disposableHost({}, 'linux', docker), null);
});
