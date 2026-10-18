import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { COMPUTED_IMPORTS, analyzeSource } from '../scripts/policy/source.mjs';

const problems = (file, text) =>
  analyzeSource(file, text).problems.filter((problem) => problem.includes('computed specifier'));

test('only the listed loaders may import code by a computed specifier (ADR 0078, 3.3)', () => {
  // The launchers of the core release and the confinement of every entry's resolution; the
  // module loader comes with stage X4.
  assert.deepEqual(Object.keys(COMPUTED_IMPORTS).sort(), [
    'apps/deploy/src/manage.ts',
    'apps/deploy/src/remote-workflow.ts',
    'apps/deploy/src/runtime.ts',
    'packages/resolution/src/index.ts',
  ]);
  assert.equal(problems('apps/deploy/src/runtime.ts', 'await import(entry);').length, 0);
  for (const file of ['apps/api/src/server.ts', 'packages/infrastructure/src/modules.ts']) {
    assert.equal(problems(file, 'await import(path);').length, 1, file);
    assert.equal(problems(file, 'await import(`./${name}.js`);').length, 1, file);
    assert.equal(problems(file, "await import('./a' + '.js');").length, 1, file);
    assert.equal(problems(file, "await import('./model.js');").length, 0, file);
    assert.equal(problems(file, 'await import(`./model.js`);').length, 0, file);
    // The other ways to load code by a computed name in Node.
    assert.equal(problems(file, 'require(path);').length, 1, file);
    assert.equal(problems(file, "import { createRequire } from 'node:module';").length, 1, file);
    assert.equal(problems(file, "import * as m from 'module';").length, 1, file);
    assert.equal(problems(file, "const m = await import('node:module');").length, 1, file);
    assert.equal(problems(file, 'this.verifier.require(id);').length, 0, file);
    // Code in a string runs elsewhere (node -e on a remote host): listed, never unseen.
    assert.equal(problems(file, 'const s = `x; await import(u);`;').length, 1, file);
    assert.equal(problems(file, "const s = 'await import (u)';").length, 1, file);
    assert.equal(problems(file, "const s = 'imports are checked';").length, 0, file);
  }
  assert.equal(problems('apps/deploy/src/remote-workflow.ts', 'const s = `import(u)`;').length, 0);
  // Tests and scripts load fixtures and tools; the rule covers the product.
  assert.equal(problems('tests/sample.test.mjs', 'await import(path);').length, 0);
  assert.equal(problems('scripts/tool.mjs', 'await import(path);').length, 0);
});

test('packages/signing keeps its allowlist and only the host tool depends on it', async () => {
  const { units } = JSON.parse(await readFile('config/architecture.json', 'utf8'));
  const unit = (path) => units.find((candidate) => candidate.path === path);
  assert.deepEqual(unit('packages/signing').allowed, ['packages/extension-api']);
  // A new consumer (the loader in infrastructure, X4; arkvoryctl, X5) is added with review.
  assert.deepEqual(
    units.filter((candidate) => candidate.allowed.includes('packages/signing')).map((u) => u.path),
    ['apps/deploy'],
  );
  assert.ok(
    units.findIndex((u) => u.path === 'packages/signing') >
      units.findIndex((u) => u.path === 'packages/extension-api'),
  );
});
