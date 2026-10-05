import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse, stringify } from 'yaml';
import { inspectPagesWorkflow } from '../scripts/policy/pages-workflow.mjs';

test('the documentation workflow publishes main only, from a checked build, with a bounded token', async () => {
  const original = await readFile('.github/workflows/pages.yml', 'utf8');
  assert.deepEqual(inspectPagesWorkflow(original), []);
  for (const [mutate, problem] of [
    [(w) => (w.on.pull_request = {}), /only pushes and manual runs/],
    [(w) => (w.on.push.branches = ['main', 'docs/*']), /only main is published/],
    [(w) => (w.permissions = { contents: 'read', pages: 'write' }), /default token/],
    [(w) => (w.jobs.build.permissions = { pages: 'write' }), /may not elevate/],
    [(w) => (w.jobs.deploy.permissions.contents = 'write'), /exactly pages:write/],
    [(w) => delete w.jobs.build.if, /build: trusted main/],
    [(w) => (w.jobs.deploy.needs = []), /publishes only what the build made/],
    [(w) => w.jobs.deploy.steps.unshift({ run: 'npm ci' }), /runs nothing but the deploy/],
    [
      (w) => (w.jobs.build.steps.find((s) => s.run === 'npm run gate -- docs').if = 'false'),
      /must pass the docs gate/,
    ],
    [
      (w) => (w.jobs.build.steps.find((s) => s.uses?.startsWith('actions/configure')).uses += '-x'),
      /immutable full SHAs/,
    ],
    [
      (w) => (w.jobs.build.steps[0].with['persist-credentials'] = true),
      /credentials must not persist/,
    ],
    [(w) => (w.jobs.build['timeout-minutes'] = 600), /bounded job timeout/],
    [(w) => (w.jobs.deploy['continue-on-error'] = true), /continue-on-error/],
    [(w) => (w.jobs.build['runs-on'] = 'ubuntu-latest'), /pinned version/],
    [(w) => (w.jobs.extra = { ...w.jobs.deploy }), /unexpected jobs/],
  ]) {
    const workflow = parse(original);
    mutate(workflow);
    const problems = inspectPagesWorkflow(stringify(workflow));
    assert(
      problems.some((text) => problem.test(text)),
      `${String(problem)}: ${problems.join('; ')}`,
    );
  }
});
