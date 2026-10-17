import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { loadInstallation, parseModuleSelections } from '../packages/infrastructure/dist/index.js';
import { modulePackage, moduleInstallation, revocationList } from './module-fixtures.mjs';

/** Lets everyone create, rename and delete entries of `directory`, not of what it holds. */
function openDirectory(directory) {
  if (process.platform !== 'win32') return chmod(directory, 0o777);
  execFileSync('icacls.exe', [directory, '/grant', '*S-1-1-0:M'], { windowsHide: true });
}

async function outcome(host, id) {
  const loaded = await loadInstallation({
    role: 'api',
    coreVersion: '0.6.0',
    selections: parseModuleSelections({ format: 1, modules: { [id]: { enabled: true } } }),
    installed: host.source(),
    now: Date.now(),
  });
  const refused = loaded.refused.find((m) => m.id === id);
  return refused ? `${refused.status}:${refused.code}` : 'loaded';
}

test('an installation root others may change trusts no module', async (t) => {
  const host = await moduleInstallation(t);
  await host.install(modulePackage(host.keys.module, { id: 'steady' }));
  assert.equal(await outcome(host, 'steady'), 'loaded');
  // Whoever may change the root may rename modules/ and put another tree in its place between
  // the checks and the import, or plant node_modules beside it.
  await openDirectory(host.root);
  assert.equal(await outcome(host, 'steady'), 'failed:access_unsafe');
});

test('a revocation list in a directory others may change trusts no module', async (t) => {
  const host = await moduleInstallation(t);
  await host.install(modulePackage(host.keys.module, { id: 'revoked' }));
  const list = revocationList(host.keys.module, {
    sequence: 2,
    entries: [
      {
        id: 'revoked',
        versions: ['1.0.0'],
        reason: 'unsafe_read',
        readOnly: false,
        replacement: null,
      },
    ],
  });
  await host.run('revocations', await host.writeFileIn('revocations.json', list));
  assert.equal(await outcome(host, 'revoked'), 'revoked:unsafe_read');
  // A missing list revokes nothing, so whoever may delete it would bring the version back.
  const config = join(host.root, 'config');
  await openDirectory(config);
  await rm(host.source().revocationsFile);
  assert.equal(await outcome(host, 'revoked'), 'failed:access_unsafe');
});
