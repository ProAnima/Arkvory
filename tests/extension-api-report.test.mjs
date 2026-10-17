import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
