import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse, stringify } from 'yaml';
import { inspectWorkflow } from '../scripts/policy/workflow.mjs';
import { ciVerdict } from '../scripts/policy/ci-result.mjs';

const original = parse(await readFile('.github/workflows/check.yml', 'utf8'));
const registry = JSON.parse(await readFile('config/gates.json', 'utf8'));

test('independent native lanes cannot omit a platform, gate or report', () => {
  assert.deepEqual(inspectWorkflow(stringify(original), registry), []);
  for (const lane of ['check', 'deployment', 'deployment-services']) {
    for (const mutate of [
      (job) => job.strategy.matrix.os.pop(),
      (job) => (job.strategy.matrix.exclude = [{ os: 'windows-2025' }]),
      (job) => (job['runs-on'] = 'ubuntu-24.04'),
      (job) => (job.strategy['fail-fast'] = true),
      (job) => (job.if = 'false'),
      (job) => (job.steps.find((s) => s.run?.startsWith('npm run gate -- ')).if = 'false'),
      (job) => (job.steps = job.steps.filter((s) => s.run !== 'node scripts/ci-report.mjs')),
    ]) {
      const changed = structuredClone(original);
      mutate(changed.jobs[lane]);
      assert.ok(inspectWorkflow(stringify(changed), registry).length, lane);
    }
  }
});

test('merge requires both split deployment lanes even when results are absent', () => {
  const needs = Object.fromEntries(
    original.jobs.verdict.needs.map((name) => [
      name,
      { result: name === 'large' ? 'skipped' : 'success' },
    ]),
  );
  assert.deepEqual(ciVerdict(needs, false), []);
  for (const lane of ['deployment', 'deployment-services']) {
    for (const result of ['failure', 'cancelled', 'skipped', undefined]) {
      const changed = structuredClone(needs);
      if (result === undefined) delete changed[lane];
      else changed[lane].result = result;
      assert.ok(ciVerdict(changed, false).some((error) => error.startsWith(`${lane}:`)));
    }
    const changed = structuredClone(original);
    changed.jobs.verdict.needs = changed.jobs.verdict.needs.filter((name) => name !== lane);
    assert.match(inspectWorkflow(stringify(changed), registry).join('\n'), /every lane/);
  }
});
