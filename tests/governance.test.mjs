import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, access, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { analyzeSource, inspectExceptions } from '../scripts/policy/source.mjs';
import { planGates, testInventory } from '../scripts/policy/inventory.mjs';
import { inspectWorkflow } from '../scripts/policy/workflow.mjs';
import { inspectCompilerOptions } from '../scripts/policy/compiler.mjs';
import { ciVerdict } from '../scripts/policy/ci-result.mjs';
import { runProcess } from '../scripts/gates/process.mjs';
import { lockGates } from '../scripts/gates/lock.mjs';
import { cleanBuild } from '../scripts/gates/clean-build.mjs';
import { gateSummary } from '../scripts/gates/report.mjs';
import { removeTestDirectory } from './helpers.mjs';

const now = Date.parse('2026-09-25');
const policy = { limits: { file: 500, class: 300, function: 2 }, maxExceptionDays: 90 };
const source =
  '// arkvory-exception ARCH-001 -- Keep the transaction intact until a reviewed extraction.\nfunction save() {\n  return 1;\n}\n';
const analysis = () =>
  new Map([
    ['packages/application/src/save.ts', analyzeSource('packages/application/src/save.ts', source)],
  ]);
const exception = () => ({
  id: 'ARCH-001',
  file: 'packages/application/src/save.ts',
  metric: 'function',
  symbol: 'save',
  ceiling: 3,
  reason: 'Keep the transaction intact until a reviewed extraction with concurrency tests.',
  owner: 'Arkvory maintainers',
  recordedAt: '2026-09-25',
  reviewBy: '2026-12-20',
  decision: 'docs/adr/0027-executable-engineering-gates.md',
  tests: ['tests/governance.test.mjs'],
});

test('AST counts code, multiline literals, classes and arrows while excluding comments', () => {
  const text = [
    '// comment',
    'class Box {',
    '  // comment',
    '  read = () => {',
    '    return `first',
    'second`;',
    '  };',
    '}',
  ].join('\n');
  const a = analyzeSource('sample.ts', text);
  assert.equal(a.metrics.find((m) => m.metric === 'file').size, 6);
  assert.equal(a.metrics.find((m) => m.metric === 'class').size, 6);
  assert.equal(a.metrics.find((m) => m.metric === 'function').size, 4);
  assert.equal(a.comments.length, 2);
});

test('frozen exception requires exact ceiling, explanation, evidence and unexpired dates', () => {
  assert.deepEqual(inspectExceptions(analysis(), policy, [exception()], now), []);
  for (const change of [
    { ceiling: 2 },
    { ceiling: 4 },
    { reviewBy: '2026-09-24' },
    { reviewBy: '2027-09-25' },
    { recordedAt: '2026-10-01' },
    { reason: 'short' },
    { owner: '' },
    { tests: [] },
    { decision: 'no-adr' },
    { symbol: 'missing' },
  ])
    assert.ok(
      inspectExceptions(analysis(), policy, [{ ...exception(), ...change }], now).length,
      JSON.stringify(change),
    );
  assert.ok(inspectExceptions(analysis(), policy, [], now).length);
  assert.ok(inspectExceptions(analysis(), policy, [exception(), exception()], now).length);
  assert.ok(
    inspectExceptions(
      analysis(),
      { ...policy, limits: { ...policy.limits, function: 100 } },
      [exception()],
      now,
    ).length,
  );
});

test('exception comment must be adjacent and registered in the same file', () => {
  const altered = source.replace('function save', 'const other = 1;\nfunction save');
  const analyses = new Map([
    [
      'packages/application/src/save.ts',
      analyzeSource('packages/application/src/save.ts', altered),
    ],
  ]);
  assert.match(inspectExceptions(analyses, policy, [exception()], now).join('\n'), /adjacent/);
  const missing = new Map([['other.ts', analyzeSource('other.ts', source)]]);
  assert.match(inspectExceptions(missing, policy, [exception()], now).join('\n'), /unregistered/);
});

test('suppression text in strings is safe; actual suppressions and disabled tests fail', () => {
  assert.deepEqual(
    analyzeSource('tests/a.test.mjs', 'const text = "// @ts-ignore test.skip";').problems,
    [],
  );
  for (const text of [
    '// @ts-ignore\nconst x=1;',
    '/* eslint-disable */',
    'test.only("x",()=>{});',
    'test.skip("x",()=>{});',
    'test("x",{skip:true},()=>{});',
    'test("x",{todo:"later"},()=>{});',
  ])
    assert.ok(analyzeSource('tests/a.test.mjs', text).problems.length, text);
  assert.ok(
    analyzeSource('packages/domain/src/x.ts', 'const a=Date.now(); const b=new Date();').problems
      .length,
  );
  assert.deepEqual(
    analyzeSource('packages/infrastructure/src/x.ts', 'const a=Date.now();').problems,
    [],
  );
});

test('gate DAG rejects unknown nodes and cycles and builds shared dependencies once', () => {
  const registry = {
    profiles: { quick: ['unit', 'integration'] },
    tasks: {
      build: { needs: [], timeoutSeconds: 10 },
      unit: { needs: ['build'], timeoutSeconds: 10 },
      integration: { needs: ['build'], timeoutSeconds: 10 },
    },
  };
  assert.deepEqual(planGates(registry, ['quick']), ['build', 'unit', 'integration']);
  assert.throws(() => planGates(registry, ['absent']), /Unknown gate/);
  registry.tasks.build.needs = ['unit'];
  assert.throws(() => planGates(registry, ['quick']), /cycle/);
  registry.tasks.build.needs = [];
  registry.tasks.build.timeoutSeconds = 0;
  assert.throws(() => planGates(registry, ['quick']), /timeout/);
});

test('test inventory reaches imported helpers but rejects an orphan or empty suite', () => {
  const registry = { tasks: { unit: { pattern: 'tests/*.test.mjs' } }, spawnedHelpers: [] };
  const analyses = new Map([
    ['tests/a.test.mjs', analyzeSource('tests/a.test.mjs', "import './helper.mjs';")],
    ['tests/helper.mjs', analyzeSource('tests/helper.mjs', 'export const value = 1;')],
  ]);
  assert.deepEqual(testInventory(registry, analyses), []);
  analyses.set('tests/new-suite.mjs', analyzeSource('tests/new-suite.mjs', ''));
  assert.match(testInventory(registry, analyses).join('\n'), /outside every gate/);
  assert.match(testInventory(registry, new Map()).join('\n'), /Empty/);
});

test('aggregate cannot accept missing, failed, cancelled or skipped mandatory jobs', () => {
  const needs = Object.fromEntries(
    ['check', 'integration', 'browser', 'security', 'large', 'deployment-containers', 'native'].map(
      (name) => [name, { result: 'success' }],
    ),
  );
  assert.deepEqual(ciVerdict(needs, true), []);
  assert.deepEqual(ciVerdict({ ...needs, newAdapter: { result: 'success' } }, true), []);
  assert.ok(ciVerdict({ ...needs, newAdapter: { result: 'failure' } }, true).length);
  assert.ok(ciVerdict({ ...needs, newAdapter: { result: 'skipped' } }, false).length);
  for (const name of [
    'check',
    'integration',
    'browser',
    'security',
    'large',
    'deployment-containers',
    'native',
  ]) {
    for (const result of ['failure', 'cancelled', 'skipped'])
      assert.ok(ciVerdict({ ...needs, [name]: { result } }, true).length);
    assert.ok(ciVerdict({ ...needs, [name]: undefined }, true).length);
  }
  assert.deepEqual(ciVerdict({ ...needs, large: { result: 'skipped' } }, false), []);
  assert.ok(ciVerdict({ ...needs, large: { result: 'failure' } }, false).length);
});

test('workflow guard catches bypasses and mutable actions', async () => {
  const original = await readFile('.github/workflows/check.yml', 'utf8');
  assert.deepEqual(inspectWorkflow(original), []);
  for (const mutate of [
    (w) => {
      delete w.on.merge_group;
    },
    (w) => {
      w.jobs.verdict.if = 'success()';
    },
    (w) => {
      w.jobs.verdict.needs = ['check'];
    },
    (w) => {
      w.jobs.newAdapter = structuredClone(w.jobs.integration);
    },
    (w) => {
      w.jobs.browser.if = 'false';
    },
    (w) => {
      w.jobs.browser.if = false;
    },
    (w) => {
      w.jobs.browser.steps.find((s) => s.run === 'npm run gate -- browser').if = false;
    },
    (w) => {
      w.jobs.large.if = 'false';
    },
    (w) => {
      w.jobs.security.steps = w.jobs.security.steps.filter(
        (s) => s.run !== 'node scripts/ci-report.mjs',
      );
    },
    (w) => {
      w.jobs.verdict.steps.find(
        (s) => s.run === 'node scripts/ci-verdict.mjs',
      ).env.ARKVORY_RELEASE_REQUIRED = 'false';
    },
    (w) => {
      w.jobs.browser.steps.push({ run: 'node tests/browser/console.mjs' });
    },
    (w) => {
      w.jobs.check.steps[0].uses = 'actions/checkout@main';
    },
    (w) => {
      w.jobs.integration['continue-on-error'] = true;
    },
    (w) => {
      w.on.pull_request = { 'paths-ignore': ['docs/**'] };
    },
  ]) {
    const workflow = parse(original);
    mutate(workflow);
    assert.ok(inspectWorkflow(stringify(workflow)).length);
  }
});

test('every registered gate must reach CI and explicit strict overrides are rejected', async () => {
  const workflow = await readFile('.github/workflows/check.yml', 'utf8');
  const registry = JSON.parse(await readFile('config/gates.json', 'utf8'));
  assert.deepEqual(inspectWorkflow(workflow, registry), []);
  registry.tasks.forgotten = { needs: [], timeoutSeconds: 10 };
  assert.match(inspectWorkflow(workflow, registry).join('\n'), /Gate absent from CI: forgotten/);
  const expanded = parse(workflow);
  expanded.jobs.extra = structuredClone(expanded.jobs.integration);
  expanded.jobs.extra.steps.find((s) => s.run === 'npm run gate -- integration').run =
    'npm run gate -- forgotten';
  expanded.jobs.verdict.needs.push('extra');
  assert.match(
    inspectWorkflow(stringify(expanded), registry).join('\n'),
    /missing from verify: forgotten/,
  );
  const { compilerOptions } = JSON.parse(await readFile('tsconfig.base.json', 'utf8'));
  assert.deepEqual(inspectCompilerOptions(compilerOptions, 'test'), []);
  assert.deepEqual(
    inspectCompilerOptions({ ...compilerOptions, lib: ['lib.es2023.d.ts'] }, 'test', true),
    [],
  );
  assert.ok(inspectCompilerOptions({ ...compilerOptions, types: ['node'] }, 'test', true).length);
  assert.ok(
    inspectCompilerOptions({ ...compilerOptions, lib: ['lib.dom.d.ts'] }, 'test', true).length,
  );
  for (const change of [
    { strict: false },
    { strictNullChecks: false },
    { noImplicitAny: false },
    { useUnknownInCatchVariables: false },
    { noCheck: true },
    { allowJs: true },
    { skipLibCheck: true },
  ])
    assert.ok(
      inspectCompilerOptions({ ...compilerOptions, ...change }, 'test').length,
      JSON.stringify(change),
    );
});

test('gate process propagates nonzero exit, enforces timeout and cancellation', async () => {
  const options = { cwd: process.cwd(), timeoutMs: 5000 };
  await runProcess('-e', ['process.exit(0)'], options);
  await assert.rejects(runProcess('-e', ['process.exit(7)'], options), /exit 7/);
  await assert.rejects(
    runProcess('-e', ['setInterval(()=>{},1000)'], { ...options, timeoutMs: 200 }),
    /timed out/,
  );
  const controller = new AbortController();
  const running = runProcess('-e', ['setInterval(()=>{},1000)'], {
    ...options,
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(running, /cancelled/);
  await assert.rejects(
    runProcess('-e', ['process.exit(0)'], { ...options, signal: controller.signal }),
    /cancelled/,
  );
});

test('exclusive gate lock rejects overlap and refuses to unlink another owner', async () => {
  const root = await mkdtemp(join(tmpdir(), 'arkvory-gates-'));
  try {
    const release = await lockGates(root);
    await assert.rejects(lockGates(root), /Another gate run/);
    await release();
    const releaseNext = await lockGates(root);
    const path = join(root, '.cache/gates.lock');
    await writeFile(path, JSON.stringify({ token: 'replacement-owner' }));
    await assert.rejects(releaseNext(), /ownership changed/);
    await access(path);
  } finally {
    await removeTestDirectory(root);
  }
});

test('clean build removes only generated outputs and rejects traversal and junctions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'arkvory-build-'));
  try {
    const src = join(root, 'packages/core/src'),
      dist = join(root, 'packages/core/dist');
    await mkdir(src, { recursive: true });
    await mkdir(dist, { recursive: true });
    await writeFile(join(src, 'keep.ts'), 'export const keep = true;');
    await writeFile(join(dist, 'stale.js'), 'stale');
    await assert.rejects(cleanBuild(root, [{ path: '../outside' }]), /Invalid/);
    await access(join(dist, 'stale.js'));
    await cleanBuild(root, [{ path: 'packages/core' }]);
    await assert.rejects(access(dist), { code: 'ENOENT' });
    await access(join(src, 'keep.ts'));
    await symlink(src, dist, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(cleanBuild(root, [{ path: 'packages/core' }]), /symlink/);
    await access(join(src, 'keep.ts'));
  } finally {
    await removeTestDirectory(root);
  }
});

test('CI summary preserves failed and unexecuted gates and rejects missing/malformed reports', async () => {
  const root = await mkdtemp(join(tmpdir(), 'arkvory-report-'));
  try {
    const folder = join(root, 'test-results/gates');
    await mkdir(folder, { recursive: true });
    await assert.rejects(gateSummary(root), /No gate report/);
    const path = join(folder, 'run.json');
    await writeFile(
      path,
      JSON.stringify({
        status: 'failed',
        tasks: [
          { name: 'unit', status: 'failed' },
          { name: 'browser', status: 'not_run' },
        ],
        error: 'failure\n::warning::example',
      }),
    );
    const report = await gateSummary(root);
    assert.match(report, /"status": "failed"/);
    assert.match(report, /"status": "not_run"/);
    assert.ok(!report.includes('\n::warning::'));
    await writeFile(path, '{"status":"passed"}');
    await assert.rejects(gateSummary(root), /Invalid gate report/);
  } finally {
    await removeTestDirectory(root);
  }
});
