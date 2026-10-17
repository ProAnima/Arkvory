import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  loadInstallation,
  parseModuleSelections,
  unsafeEntries,
} from '../packages/infrastructure/dist/index.js';
import {
  modulePackage,
  moduleInstallation,
  openToEveryone,
  revocationList,
  temporaryDirectory,
} from './module-fixtures.mjs';

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

/**
 * A Get-Acl that reports every path owned by SYSTEM with no access rules: what the service
 * account could put in its own PowerShell module path (Documents of its profile, writable by
 * every LocalService service) to make the check see a package open to it as safe.
 */
const FAKE_GET_ACL = `function Get-Acl {
  param([string]$LiteralPath)
  $security = [System.Security.AccessControl.FileSecurity]::new()
  $security.SetOwner([System.Security.Principal.SecurityIdentifier]'S-1-5-18')
  $security
}
Export-ModuleMember -Function Get-Acl
`;

const POWERSHELL = join(
  process.env['SystemRoot'] ?? 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe',
);

test('the ACL check reads access with the system PowerShell modules only', async (t) => {
  const directory = await temporaryDirectory(t, 'arkvory-acl-');
  const file = join(directory, 'main.mjs');
  await writeFile(file, 'export {};\n');
  await openToEveryone(file);
  if (process.platform !== 'win32') {
    // Without PowerShell the Windows check cannot run: unverified, never safe.
    await assert.rejects(unsafeEntries([file], directory, 'win32'), { code: 'access_unverified' });
    return;
  }
  const profile = join(directory, 'profile');
  const planted = join(
    profile,
    'Documents/WindowsPowerShell/Modules/Microsoft.PowerShell.Security',
  );
  await mkdir(planted, { recursive: true });
  await writeFile(join(planted, 'Microsoft.PowerShell.Security.psm1'), FAKE_GET_ACL);
  const saved = process.env['USERPROFILE'];
  t.after(() => {
    process.env['USERPROFILE'] = saved;
  });
  process.env['USERPROFILE'] = profile;
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'psmodulepath'),
  );
  // The planted module is what PowerShell would autoload for Get-Acl in this environment.
  const found = execFileSync(
    POWERSHELL,
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      '(Get-Command Get-Acl).Module.Path',
    ],
    { env, windowsHide: true },
  ).toString();
  assert.match(found, /profile/);
  assert.deepEqual([...(await unsafeEntries([file], directory))], [file]);
});
