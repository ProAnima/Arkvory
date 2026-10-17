import test from 'node:test';
import assert from 'node:assert/strict';
import { COMPUTED_IMPORTS, analyzeSource } from '../scripts/policy/source.mjs';

const problems = (file, text) =>
  analyzeSource(file, text).problems.filter((problem) => problem.includes('computed specifier'));

test('only the listed loaders may import code by a computed specifier (ADR 0078, 3.3)', () => {
  // Only the launchers of the core release so far; the module loader comes with stage X4.
  assert.deepEqual(Object.keys(COMPUTED_IMPORTS).sort(), [
    'apps/deploy/src/manage.ts',
    'apps/deploy/src/runtime.ts',
  ]);
  assert.equal(problems('apps/deploy/src/runtime.ts', 'await import(entry);').length, 0);
  for (const file of ['apps/api/src/server.ts', 'packages/infrastructure/src/modules.ts']) {
    assert.equal(problems(file, 'await import(path);').length, 1, file);
    assert.equal(problems(file, 'await import(`./${name}.js`);').length, 1, file);
    assert.equal(problems(file, "await import('./a' + '.js');").length, 1, file);
    assert.equal(problems(file, "await import('./model.js');").length, 0, file);
    assert.equal(problems(file, 'await import(`./model.js`);').length, 0, file);
  }
  // Tests and scripts load fixtures and tools; the rule covers the product.
  assert.equal(problems('tests/sample.test.mjs', 'await import(path);').length, 0);
  assert.equal(problems('scripts/tool.mjs', 'await import(path);').length, 0);
});
