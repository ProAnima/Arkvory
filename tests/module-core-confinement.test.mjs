import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadInstallation, parseModuleSelections } from '../packages/infrastructure/dist/index.js';
import {
  allowResolutionUnder,
  confineResolution,
  resolutionConfined,
} from '../packages/resolution/dist/index.js';
import { modulePackage, moduleInstallation } from './module-fixtures.mjs';

// This process is confined like a service entry (ADR 0031): the repository plays the release.
confineResolution();
allowResolutionUnder(fileURLToPath(new URL('..', import.meta.url)));
assert.ok(resolutionConfined());

const entryOf = (host, id) => pathToFileURL(join(host.modules, id, '1.0.0', 'files/main.mjs')).href;

test('a verified package joins the core confinement only after its checks, one by one', async (t) => {
  const host = await moduleInstallation(t);
  await host.install(modulePackage(host.keys.module, { id: 'admitted' }));
  await host.install(modulePackage(host.keys.module, { id: 'tampered' }));
  await writeFile(join(host.modules, 'tampered/1.0.0/files/main.mjs'), 'globalThis.pwned = 1;\n');
  // Before the loader verified anything, the modules directory is outside the confinement.
  await assert.rejects(import(entryOf(host, 'admitted')), { code: 'ERR_MODULE_NOT_FOUND' });
  const admitted = [];
  const loaded = await loadInstallation({
    role: 'api',
    coreVersion: '0.6.0',
    selections: parseModuleSelections({
      format: 1,
      modules: { admitted: { enabled: true }, tampered: { enabled: true } },
    }),
    installed: host.source(),
    now: Date.now(),
    admit: (directory) => {
      admitted.push(directory);
      allowResolutionUnder(directory);
    },
  });
  assert.deepEqual(admitted, [join(host.modules, 'admitted', '1.0.0')]);
  assert.deepEqual(
    loaded.refused.map((m) => [m.id, m.code]),
    [['tampered', 'file_mismatch']],
  );
  loaded.prepared.get('admitted').create({});
  // The refused package and the modules directory itself stay outside.
  await assert.rejects(import(entryOf(host, 'tampered')), { code: 'ERR_MODULE_NOT_FOUND' });
  assert.equal(globalThis.pwned, undefined);
  const set = pathToFileURL(join(host.modules, 'installed.json')).href;
  await assert.rejects(import(set, { with: { type: 'json' } }), { code: 'ERR_MODULE_NOT_FOUND' });
});
