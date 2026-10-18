import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  loadInstallation,
  parseModuleSelections,
  aclProblem,
  unsafeAcl,
  unsafeEntries,
} from '../packages/infrastructure/dist/index.js';
import {
  modulePackage,
  moduleInstallation,
  openToEveryone,
  protectRoot,
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
  // Which path and which rule refused it, in the test output when an assertion fails.
  if (refused?.detail) console.log(`# ${id} ${refused.code}: ${refused.detail}`);
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
  assert.deepEqual([...(await unsafeEntries([file], directory)).keys()], [file]);
});

const SYSTEM = 'S-1-5-18';
const ADMINS = 'S-1-5-32-544';
const USERS = 'S-1-5-32-545';
const LOCAL_SERVICE = 'S-1-5-19';
const CREATOR_OWNER = 'S-1-3-0';
const ADMIN_USER = 'S-1-5-21-1-2-3-500';
const OTHER_USER = 'S-1-5-21-1-2-3-1001';
const FULL = 0x1f01ff;
const READ = 0x1200a9;
const rule = (sid, rights, { allow = true, inheritOnly = false } = {}) => ({
  sid,
  rights,
  allow,
  inheritOnly,
});
const installerRules = [rule(SYSTEM, FULL), rule(ADMINS, FULL), rule(LOCAL_SERVICE, READ)];

test('which ACL entries make a path unsafe on Windows, rule by rule', () => {
  const verdict = (rootOwner, owner, rules) =>
    unsafeAcl({ owner: rootOwner, rules: [] }, { owner, rules: [...installerRules, ...rules] });
  // What the installers write: administrators, LocalService reading.
  assert.equal(verdict(ADMINS, ADMINS, []), false);
  // Rules that grant nothing on the entry itself: inherit-only, CREATOR OWNER, deny, reading.
  assert.equal(verdict(ADMINS, ADMINS, [rule(USERS, FULL, { inheritOnly: true })]), false);
  assert.equal(
    verdict(ADMINS, ADMINS, [rule(CREATOR_OWNER, 0x10000000, { inheritOnly: true })]),
    false,
  );
  assert.equal(verdict(ADMINS, ADMINS, [rule(CREATOR_OWNER, FULL)]), false);
  assert.equal(verdict(ADMINS, ADMINS, [rule('S-1-1-0', FULL, { allow: false })]), false);
  assert.equal(verdict(ADMINS, ADMINS, [rule(USERS, READ)]), false);
  // GENERIC_READ arrives as a negative 32-bit value: no write right in it.
  assert.equal(verdict(ADMINS, ADMINS, [rule(USERS, -1610612736)]), false);
  // The owner of the installation root is trusted, as its rules and as an owner.
  assert.equal(verdict(ADMIN_USER, ADMIN_USER, [rule(ADMIN_USER, FULL)]), false);
  assert.equal(verdict(ADMIN_USER, ADMINS, [rule(ADMIN_USER, FULL)]), false);
  // Anyone else who may write, create, delete or change permissions makes it unsafe, an
  // administrator's own SID included when the root belongs to the Administrators group.
  assert.equal(verdict(ADMINS, ADMINS, [rule(ADMIN_USER, FULL)]), true);
  assert.equal(verdict(ADMINS, ADMINS, [rule(USERS, 0x116)]), true);
  assert.equal(verdict(ADMINS, ADMINS, [rule(LOCAL_SERVICE, 0x1301bf)]), true);
  assert.equal(verdict(ADMINS, ADMINS, [rule(USERS, 0x10000000)]), true);
  assert.equal(verdict(ADMINS, ADMINS, [rule(OTHER_USER, 0x40000)]), true);
  assert.equal(verdict(ADMINS, OTHER_USER, []), true);
  // The reason names the rule, so a refusal can be traced to one access entry.
  assert.equal(
    aclProblem({ owner: ADMINS, rules: [] }, { owner: ADMINS, rules: [rule(USERS, 0x116)] }),
    'rule S-1-5-32-545 rights 0x116; owner S-1-5-32-544; root owner S-1-5-32-544',
  );
});

test('a test root is locked down like an installation, explicit rules of others included', async (t) => {
  const root = await temporaryDirectory(t, 'arkvory-lockdown-');
  // A rule written on the directory itself, as the default DACL of a CI runner's token writes
  // one for the runner account: removing inheritance alone keeps it.
  await openDirectory(root);
  await protectRoot(root);
  assert.deepEqual([...(await unsafeEntries([root], root))], []);
});
