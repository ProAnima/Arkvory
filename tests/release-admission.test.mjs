import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse, stringify } from 'yaml';
import {
  admitCommit,
  githubSource,
  largeJobs,
  mergeGateJob,
  trustedRun,
} from '../scripts/release-admission.mjs';
import { gapJobs, workflowJobs } from '../scripts/ci/ci-jobs.mjs';
import { ciAdmission } from '../scripts/ci/ci-admission.mjs';
import { notExecuted } from '../scripts/ci/lanes.mjs';
import { admitRelease, renderMarkdown, summarize } from '../scripts/ci/evidence.mjs';
import { releaseNotes } from '../scripts/ci/github-release.mjs';

const registry = JSON.parse(await readFile('config/gates.json', 'utf8'));
const checkYml = await readFile('.github/workflows/check.yml', 'utf8');
const gaps = notExecuted.filter((entry) => entry.kind === 'gap');
const sha = 'a'.repeat(40);
const other = 'b'.repeat(40);
const jobs = workflowJobs(checkYml, registry);
const run = (extra = {}) => ({
  id: 7,
  html_url: 'https://github.com/ProAnima/Arkvory/actions/runs/7',
  head_sha: sha,
  head_branch: 'main',
  event: 'push',
  status: 'completed',
  conclusion: 'success',
  ...extra,
});
const green = () => jobs.map((job) => ({ name: job.name, conclusion: 'success' }));
const source = (runs, jobsOf = () => green()) => ({
  listRuns: async () => runs,
  listJobs: async (item) => jobsOf(item),
});
const host = { os: 'Windows_NT 10', node: 'v24', docker: '29' };

test('every local gap is executed by a check.yml job on its CI platform', () => {
  const { coverage, problems } = gapJobs(jobs, gaps);
  assert.deepEqual(problems, []);
  const find = (gate, platform) =>
    coverage.find((item) => item.gate === gate && item.platform === platform).jobs;
  assert.deepEqual(find('deployment-services', 'win32'), [
    'Quality (windows-2022)',
    'Quality (windows-2025)',
  ]);
  assert.deepEqual(find('native-install', 'win32'), ['Native installer (windows-2022)']);
  assert.deepEqual(find('deployment-containers', 'linux'), ['Container deployment and update']);
  assert.ok(jobs.some((job) => job.name === mergeGateJob));
  for (const name of largeJobs) assert.ok(jobs.some((job) => job.name === name));
});

test('a gap whose CI job disappears or is disabled is not covered', () => {
  const without = parse(checkYml);
  delete without.jobs.nas;
  assert.match(
    gapJobs(workflowJobs(stringify(without), registry), gaps).problems.join('\n'),
    /deployment-nas \(win32\): no CI job on linux/,
  );
  const disabled = parse(checkYml);
  disabled.jobs.native.steps.find((s) => s.run === 'npm run gate -- native-install').if = 'false';
  assert.match(
    gapJobs(workflowJobs(stringify(disabled), registry), gaps).problems.join('\n'),
    /native-install \(win32\)/,
  );
});

test('only completed push or merge-queue runs on main for the exact commit are trusted', () => {
  assert.equal(trustedRun(run(), sha), true);
  const queue = run({ event: 'merge_group', head_branch: 'gh-readonly-queue/main/pr-20-abc' });
  assert.equal(trustedRun(queue, sha), true);
  assert.equal(trustedRun(run(), other), false);
  assert.equal(trustedRun(run({ event: 'pull_request' }), sha), false);
  assert.equal(trustedRun(run({ event: 'workflow_dispatch' }), sha), false);
  assert.equal(trustedRun(run({ event: 'schedule' }), sha), false);
  assert.equal(trustedRun(run({ head_branch: 'feature' }), sha), false);
  assert.equal(trustedRun(run({ status: 'in_progress', conclusion: null }), sha), false);
});

test('a CI run for another commit is refused, never borrowed', async () => {
  const result = await admitCommit(sha, source([run({ head_sha: other })]));
  assert.equal(result.run, undefined);
  assert.match(result.problems.join(), /No completed check\.yml run/);
});

test('a failed merge gate, large transfer or gap job refuses the release', async () => {
  const required = gapJobs(jobs, gaps).coverage.flatMap((item) => item.jobs);
  const failing =
    (name, conclusion = 'failure') =>
    () =>
      green().map((job) => (job.name === name ? { ...job, conclusion } : job));
  for (const [name, conclusion] of [
    [mergeGateJob, 'failure'],
    [largeJobs[1], 'skipped'],
    ['NAS stand (backup vault on SMB and NFS)', 'cancelled'],
    ['Quality (windows-2025)', 'failure'],
  ]) {
    const result = await admitCommit(sha, {
      ...source([run()], failing(name, conclusion)),
      required,
    });
    assert.equal(result.run, undefined, name);
    assert.match(result.problems.join('\n'), new RegExp(`${conclusion} in run 7`));
  }
  const missing = await admitCommit(sha, {
    ...source([run()], () => green().filter((job) => job.name !== mergeGateJob)),
    required,
  });
  assert.match(missing.problems.join(), /Arkvory merge gate: missing/);
  const red = await admitCommit(sha, { ...source([run({ conclusion: 'failure' })]), required });
  assert.match(red.problems.join(), /concluded failure/);
});

test('the newest fully successful run is admitted and recorded', async () => {
  const runs = [run({ id: 9, conclusion: 'failure' }), run({ id: 8, html_url: 'u8' }), run()];
  const result = await admitCommit(sha, source(runs));
  assert.equal(result.run.id, 8);
  assert.equal(result.run.url, 'u8');
  assert.deepEqual(result.problems, []);
  await assert.rejects(admitCommit('main', source(runs)), /full commit/);
});

test('a truncated job list fails closed', async () => {
  const api = githubSource(async (path) =>
    path.includes('/jobs') ? { total_count: 120, jobs: green() } : { workflow_runs: [run()] },
  );
  await assert.rejects(admitCommit(sha, api), /incomplete job list/);
});

test('a release fails closed without CI; a rehearsal records the gap and goes on', async () => {
  const offline = {
    listRuns: async () => {
      throw new Error('gh api failed: Could not connect');
    },
    listJobs: async () => [],
  };
  const input = { workflow: checkYml, registry, source: offline };
  await assert.rejects(ciAdmission(sha, { ...input, strict: true }), /Could not connect/);
  const rehearsal = await ciAdmission(sha, { ...input, strict: false });
  assert.equal(rehearsal.status, 'unavailable');
  await assert.rejects(
    ciAdmission(sha, { ...input, source: source([]), strict: true }),
    /does not prove the local gaps/,
  );
  const passed = await ciAdmission(sha, { ...input, source: source([run()]), strict: true });
  assert.equal(passed.status, 'passed');
  assert.equal(passed.run.id, 7);
});

test('releasable requires passed local lanes and CI coverage for the same commit', async () => {
  const lanes = ['windows', 'linux', 'linux-system'].map((name) => ({
    name,
    status: 'passed',
    planned: [],
  }));
  const local = summarize({ profile: 'release', commit: sha, dirty: false, host, lanes });
  assert.deepEqual([local.localPassed, local.releasable], [true, false]);
  const input = { workflow: checkYml, registry, strict: false };
  const ci = await ciAdmission(sha, { ...input, source: source([run()]) });
  const admitted = admitRelease(local, ci);
  assert.equal(admitted.releasable, true);
  assert.match(renderMarkdown(admitted), /GitHub CI for this commit: passed \(https:/);
  assert.match(releaseNotes('1.0.0', admitted, local), /GitHub CI run https:\S+ passed/);
  assert.equal(admitRelease({ ...local, localPassed: false }, ci).releasable, false);
  assert.equal(admitRelease(local, { ...ci, commit: other }).releasable, false);
  const uncovered = { ...ci, coverage: ci.coverage.slice(1) };
  assert.equal(admitRelease(local, uncovered).releasable, false, 'A gap without CI jobs');
  const failed = await ciAdmission(sha, { ...input, source: source([run({ head_sha: other })]) });
  assert.deepEqual([failed.status, admitRelease(local, failed).releasable], ['failed', false]);
  assert.match(releaseNotes('1.0.0', admitRelease(local, failed), local), /NOT confirmed/);
});
