import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse, stringify } from 'yaml';
import { inspectWorkflow } from '../scripts/policy/workflow.mjs';
import { inspectReleaseWorkflow } from '../scripts/policy/release-workflow.mjs';
import { inspectRunnerImages } from '../scripts/policy/runners.mjs';
import { filesUnder, inspectTestFileTypes, testInventory } from '../scripts/policy/inventory.mjs';
import { analyzeSource } from '../scripts/policy/source.mjs';

const pinnedError = /runner image must be a pinned version/;

test('every CI and release job runs on an explicitly versioned runner image', async () => {
  const registry = JSON.parse(await readFile('config/gates.json', 'utf8'));
  const check = await readFile('.github/workflows/check.yml', 'utf8');
  const release = await readFile('.github/workflows/release.yml', 'utf8');
  assert.deepEqual(inspectRunnerImages(parse(check).jobs), []);
  assert.deepEqual(inspectRunnerImages(parse(release).jobs), []);
  for (const mutate of [
    (w) => {
      w.jobs.integration['runs-on'] = 'ubuntu-latest';
    },
    (w) => {
      w.jobs.native.strategy.matrix.os = ['ubuntu-24.04', 'windows-latest'];
    },
    (w) => {
      w.jobs.check.strategy.matrix.include = [{ os: 'ubuntu-latest' }];
    },
    (w) => {
      w.jobs.verdict['runs-on'] = ['self-hosted', 'linux'];
    },
    (w) => {
      delete w.jobs.security['runs-on'];
    },
  ]) {
    const changed = parse(check);
    mutate(changed);
    assert.match(inspectWorkflow(stringify(changed), registry).join('\n'), pinnedError);
  }
  for (const mutate of [
    (w) => {
      w.jobs.publish['runs-on'] = 'ubuntu-latest';
    },
    (w) => {
      w.jobs.acceptance.strategy.matrix.include = [{ os: 'windows-latest' }];
    },
  ]) {
    const changed = parse(release);
    mutate(changed);
    assert.match(inspectReleaseWorkflow(stringify(changed)).join('\n'), pinnedError);
  }
});

test('a spawned helper counts only when gate-reached code starts it', () => {
  const helper = 'tests/deployment/child.mjs';
  const registry = { tasks: { unit: { pattern: 'tests/*.test.mjs' } }, spawnedHelpers: [helper] };
  const source = (file, text) => [file, analyzeSource(file, text)];
  const analyses = new Map([
    source('tests/a.test.mjs', "fork('tests/deployment/child.mjs');"),
    source(helper, 'export {};'),
  ]);
  assert.deepEqual(testInventory(registry, analyses), []);
  analyses.set(...source('tests/a.test.mjs', 'export {};'));
  analyses.set(...source('tests/orphan.mjs', "fork('tests/deployment/child.mjs');"));
  assert.deepEqual(testInventory(registry, analyses), [
    `Spawned helper is not started by any gate: ${helper}`,
    'Test outside every gate/import graph: tests/orphan.mjs',
  ]);
});

test('test files that no gate can execute are rejected; data and docs are not tests', async () => {
  assert.deepEqual(inspectTestFileTypes(await filesUnder('.', 'tests')), []);
  assert.deepEqual(
    inspectTestFileTypes([
      'tests/a.test.mjs',
      'tests/README.md',
      'tests/browser/scenario.mjs',
      'tests/fixtures/consumer.ts',
      'tests/fixtures/operations.json',
    ]),
    [],
  );
  for (const orphan of [
    'tests/new.test.js',
    'tests/new.test.cjs',
    'tests/new.test.ts',
    'tests/integration/new.test.mts',
    'tests/deployment/scenario.sh',
  ])
    assert.deepEqual(inspectTestFileTypes([orphan]), [
      `Test file type outside every gate: ${orphan}`,
    ]);
});
