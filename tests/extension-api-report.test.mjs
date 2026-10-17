import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXTENSION_API_VERSION } from '../packages/extension-api/dist/index.js';
import { extensionApiReport, reportPath } from '../scripts/extension-api-report.mjs';

const manifest = JSON.parse(
  await readFile(new URL('../packages/extension-api/package.json', import.meta.url), 'utf8'),
);

test('the stored declarations of the extension API match the build', async () => {
  const stored = await readFile(reportPath, 'utf8');
  assert.ok(
    stored === (await extensionApiReport()),
    'packages/extension-api/api-report.d.ts is stale: review the change for its semver level, ' +
      'raise the version, then run `node scripts/extension-api-report.mjs --write`',
  );
});

test('the contract, its manifest and its report carry one version', async () => {
  assert.equal(manifest.version, EXTENSION_API_VERSION);
  const stored = await readFile(reportPath, 'utf8');
  assert.ok(stored.startsWith(`// API report of ${manifest.name} ${EXTENSION_API_VERSION}.\n`));
});

test('the report holds index.d.ts and what its exports reach, never internal declarations', async () => {
  const stored = await readFile(reportPath, 'utf8');
  for (const internal of [
    'function checkModules',
    'function checkOwnership',
    'function checkServices',
    'function startOrder',
    'interface ReadModule',
    'RuleProblem',
  ])
    assert.equal(stored.includes(internal), false, `${internal} is not part of the contract`);
  // Reached through ModulePlanProblemCode, so published under its public name.
  assert.match(stored, /export type ModulePlanRuleCode =/);
  assert.match(stored, /export interface ModuleContext<Services>/);
  assert.match(stored, /export declare const HOST_SERVICES/);
});

test('changing an internal declaration leaves the report unchanged; a public one changes it', async (t) => {
  const dist = fileURLToPath(new URL('../packages/extension-api/dist/', import.meta.url));
  const copy = await mkdtemp(join(tmpdir(), 'arkvory-api-report-'));
  t.after(() => rm(copy, { recursive: true, force: true }));
  await cp(dist, copy, { recursive: true });
  // Each edit must apply: an edit that matched nothing would leave the report equal vacuously.
  const edit = async (name, from, to) => {
    const file = join(copy, name);
    const text = await readFile(file, 'utf8');
    assert.ok(text.includes(from), `${name} no longer declares ${from}`);
    await writeFile(file, text.replace(from, to));
  };
  await edit(
    'plan-order.d.ts',
    'export declare function startOrder',
    'export declare function internalHelper(): void;\nexport declare function startOrder',
  );
  await edit('plan-rules.d.ts', 'readonly enabled: boolean;', 'readonly on: boolean;');
  assert.equal(await extensionApiReport(copy), await extensionApiReport());
  await edit('context.d.ts', 'readonly mode: ModuleMode;', 'readonly mode: string;');
  assert.notEqual(await extensionApiReport(copy), await extensionApiReport());
});
