import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { planGates } from '../scripts/policy/inventory.mjs';
import { inspectWorkflow } from '../scripts/policy/workflow.mjs';
import { dependencies, dependency } from '../scripts/native-dependencies.mjs';
import { removeTestDirectory } from './helpers.mjs';

test('gate concurrency is bounded and database suites remain serial', async () => {
  const registry = JSON.parse(await readFile('config/gates.json', 'utf8'));
  assert.equal(registry.tasks.unit.concurrency, 2);
  assert.doesNotThrow(() => planGates(registry, ['verify']));
  for (const concurrency of [0, -1, 1.5, 5, '2', null]) {
    const changed = structuredClone(registry);
    changed.tasks.unit.concurrency = concurrency;
    assert.throws(() => planGates(changed, ['unit']), /Invalid gate concurrency/);
  }
  registry.tasks.integration.concurrency = 2;
  assert.throws(() => planGates(registry, ['integration']), /Invalid gate concurrency/);
  registry.tasks.integration.concurrency = 1;
  assert.doesNotThrow(() => planGates(registry, ['integration']));
  registry.tasks.browser.concurrency = 2;
  assert.throws(() => planGates(registry, ['browser']), /Invalid gate concurrency/);
});

test('CI matrix cannot omit, conditionally bypass or replace a large transfer scenario', async () => {
  const original = parse(await readFile('.github/workflows/check.yml', 'utf8'));
  const registry = JSON.parse(await readFile('config/gates.json', 'utf8'));
  assert.deepEqual(inspectWorkflow(stringify(original), registry), []);
  for (const mutate of [
    (job) => {
      job.strategy.matrix.gate.pop();
    },
    (job) => {
      job.strategy.matrix.gate = ['large-full', 'large-full'];
    },
    (job) => {
      job.strategy.matrix.exclude = [{ gate: 'large-multipart' }];
    },
    (job) => {
      job.strategy['fail-fast'] = true;
    },
    (job) => {
      job.strategy['max-parallel'] = 1;
    },
    (job) => {
      job.steps.find((step) => step.run === 'npm run gate -- ${{ matrix.gate }}').if = 'false';
    },
    (job) => {
      job.steps.find((step) => step.run === 'npm run gate -- ${{ matrix.gate }}').run =
        'npm run gate -- large-full';
    },
  ]) {
    const changed = structuredClone(original);
    mutate(changed.jobs.large);
    assert.ok(inspectWorkflow(stringify(changed), registry).length);
  }
});

test('native archive cache never bypasses the pinned checksum', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'depot-native-cache-'));
  try {
    await writeFile(join(directory, dependencies.nodeWindows[1] + '.archive'), 'tampered cache');
    await assert.rejects(dependency('nodeWindows', directory), /checksum mismatch/);
  } finally {
    await removeTestDirectory(directory);
  }
});
