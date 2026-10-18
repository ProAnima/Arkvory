// Windows installation hardening checks of gate deployment-services (elevated runner only):
// code directories, the verified Node.js runtime of install.ps1 and the Remote Setup stage.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  installCommand,
  makeRemoteStage,
  removeRemoteStage,
} from '../../apps/deploy/dist/remote-target.js';

const environment = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'psmodulepath'),
);
const quoted = (path) => `'${path.replaceAll("'", "''")}'`;
const powershellValue = (expression) =>
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', expression], {
    env: environment,
    encoding: 'utf8',
    windowsHide: true,
  }).trim();
const script = (path, args, env = environment) =>
  spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path, ...args],
    { env, encoding: 'utf8', windowsHide: true, timeout: 300_000 },
  );
const self = () => powershellValue('[Security.Principal.WindowsIdentity]::GetCurrent().User.Value');
const fullControl = 2032127;
const readAndExecute = 1179817;
/** Owner, protection and the sorted `sid:rights:inherited` rules of a file or directory. */
export function security(path) {
  const result = JSON.parse(
    powershellValue(
      `$acl=Get-Acl -LiteralPath ${quoted(path)}; [pscustomobject]@{ owner=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value; protected=$acl.AreAccessRulesProtected; rules=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]) | ForEach-Object { '{0}:{1}:{2}' -f $_.IdentityReference.Value,[int]$_.FileSystemRights,$_.IsInherited }) } | ConvertTo-Json -Compress`,
    ),
  );
  return { ...result, rules: [...result.rules].sort() };
}
const protectedDirectory = (readers) => ({
  owner: 'S-1-5-32-544',
  protected: true,
  rules: [
    `S-1-5-18:${fullControl}:False`,
    ...readers.map((sid) => `${sid}:${readAndExecute}:False`),
    `S-1-5-32-544:${fullControl}:False`,
  ].sort(),
});
const codeDirectories = ['runtime', 'releases', 'config', 'modules'];

/**
 * Before registration: the code directories belong to the running user, one grants Users
 * write and holds an entry with its own DACL, as if another account had made them. The same
 * user owns the GitHub token file in the root and a file in the data tree.
 */
export async function foreignCodeDirectories(root) {
  const user = self();
  for (const name of codeDirectories) await mkdir(join(root, name), { recursive: true });
  await mkdir(join(root, 'releases', '0.0.1'));
  await writeFile(join(root, 'releases', '0.0.1', 'code.js'), '');
  for (const name of codeDirectories)
    execFileSync('icacls.exe', [join(root, name), '/setowner', `*${user}`, '/T']);
  execFileSync('icacls.exe', [join(root, 'releases'), '/grant', '*S-1-5-32-545:(OI)(CI)M']);
  const code = join(root, 'releases', '0.0.1', 'code.js');
  execFileSync('icacls.exe', [code, '/inheritance:r', '/grant:r', `*${user}:F`]);
  await writeFile(join(root, 'data', 'foreign.marker'), '');
  for (const file of [join(root, 'github-token.txt'), join(root, 'data', 'foreign.marker')])
    execFileSync('icacls.exe', [file, '/setowner', `*${user}`]);
}
/** After full registration: Administrators own the code directories and only they change them. */
export function assertCodeDirectories(root) {
  for (const name of codeDirectories)
    assert.deepEqual(security(join(root, name)), protectedDirectory(['S-1-5-19']), name);
  const nested = security(join(root, 'releases', '0.0.1', 'code.js'));
  assert.equal(nested.owner, 'S-1-5-32-544', 'Entries below belong to Administrators');
  assert.equal(nested.protected, false, 'Entries below only inherit');
  assert.ok(
    nested.rules.every((rule) => rule.endsWith(':True')),
    'No own grants below',
  );
  // The reset of config does not leave the credential files readable by the services, and a
  // credential file that another account owned now belongs to Administrators.
  for (const file of [join(root, 'config', 'bootstrap-token.txt'), join(root, 'github-token.txt')])
    assert.deepEqual(security(file), {
      owner: 'S-1-5-32-544',
      protected: true,
      rules: [`S-1-5-18:${fullControl}:False`, `S-1-5-32-544:${fullControl}:False`],
    });
  // The data tree is not walked.
  assert.equal(security(join(root, 'data', 'foreign.marker')).owner, self(), 'data keeps owners');
}
/** A link at or below a code directory stops registration with a clear error. */
export async function refuseLinkedCodeDirectories(base, node, prefix) {
  const target = await mkdtemp(join(base, 'arkvory-link-target-'));
  for (const [name, link] of [
    ['releases', 'releases'],
    ['runtime', join('runtime', 'nested')],
  ]) {
    const root = await mkdtemp(join(base, 'arkvory-link-gate-'));
    await mkdir(join(root, name), { recursive: true });
    await symlink(target, join(root, link), 'junction');
    try {
      const owner = security(root).owner;
      const result = script(resolve('deploy/register-windows.ps1'), [
        ...['-Root', root, '-Node', node, '-Prefix', prefix],
      ]);
      assert.notEqual(result.status, 0, `A link at ${link} must stop registration`);
      assert.match(result.stderr + result.stdout, /is a link \(junction or symbolic link\)/);
      if (link === name) assert.equal(security(root).owner, owner, 'Refused before any change');
      assert.equal(security(target).protected, false, 'The link target is untouched');
    } finally {
      // A recursive removal does not take a Windows junction.
      await unlink(join(root, link));
    }
  }
}
const pinnedNode = async () =>
  /\$nodeSha256 = '([A-F0-9]{64})'/.exec(await readFile('deploy/install.ps1', 'utf8'))?.[1];
const sha256 = async (path) =>
  createHash('sha256')
    .update(await readFile(path))
    .digest('hex')
    .toUpperCase();
/**
 * install.ps1 replaces a runtime that fails verification with a freshly verified one, runs only
 * that one, and leaves the runtime directory with Administrators.
 */
export async function verifiedRuntime(base) {
  const directory = await mkdtemp(join(base, 'arkvory-runtime-gate-'));
  const artifact = join(directory, 'artifact');
  const root = join(directory, 'root');
  await mkdir(artifact);
  const setup = join(artifact, 'arkvory-setup.mjs');
  await copyFile('tests/deployment/execution-probe.mjs', setup);
  const manifest = { version: '1.2.3', setupSha256: await sha256(setup) };
  await writeFile(join(artifact, 'arkvory-release.json'), JSON.stringify(manifest));
  const config = join(directory, 'native.json');
  await writeFile(config, '{}');
  const current = join(root, 'runtime', 'node-v24.21.0-win-x64');
  await mkdir(current, { recursive: true });
  await writeFile(join(current, 'node.exe'), 'not the pinned runtime');
  const output = join(directory, 'observed.json');
  const env = { ...environment, ARKVORY_PROBE_OUTPUT: output };
  const args = ['-Root', root, '-Artifact', artifact, '-Config', config];
  for (const run of ['replace', 'reuse']) {
    const result = script(resolve('deploy/install.ps1'), args, env);
    assert.equal(result.status, 0, `install.ps1 (${run}): ${result.stderr}`);
    const observed = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(observed.execPath.toLowerCase(), join(current, 'node.exe').toLowerCase());
    assert.equal(await sha256(join(current, 'node.exe')), await pinnedNode());
    const aside = (await readdir(join(root, 'runtime'))).filter((name) =>
      name.startsWith('unverified-'),
    );
    assert.equal(aside.length, 1, 'The unverified runtime is kept aside once and never run');
  }
  assert.deepEqual(security(join(root, 'runtime')), protectedDirectory(['S-1-5-19']));
}
/** One generated command run locally, as the SSH session of an administrator would. */
const local = {
  async exec(command) {
    const [file, ...args] = command.split(' ');
    const result = spawnSync(file, args, {
      env: local.env,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 120_000,
    });
    if (result.status !== 0)
      throw Object.assign(new Error(result.stderr), { status: result.status });
    return result.stdout;
  },
  env: environment,
};
/**
 * The Remote Setup stage exists only as a protected directory of Administrators; the installer
 * runs from its verified copy there, and nothing remains afterwards.
 */
export async function remoteStage(base) {
  const target = { platform: 'windows', packaging: 'exe', installed: false };
  const id = randomUUID();
  const stage = await makeRemoteStage(local, target, id);
  try {
    assert.deepEqual(security(stage), protectedDirectory([]));
    await assert.rejects(makeRemoteStage(local, target, id), 'An existing stage stops');
    const installer = `${stage}/Arkvory-Setup-x64.exe`;
    await copyFile(process.execPath, installer);
    const hash = (await sha256(installer)).toLowerCase();
    const verified = `${stage}/verified-Arkvory-Setup-x64.exe`;
    await assert.rejects(local.exec(installCommand(target, installer, 'f'.repeat(64))), {
      status: 3,
    });
    assert.equal(existsSync(verified), false, 'A refused copy is removed');
    const output = join(await mkdtemp(join(base, 'arkvory-stage-gate-')), 'observed.json');
    const probe = resolve('tests/deployment/execution-probe.mjs');
    local.env = {
      ...environment,
      ARKVORY_PROBE_OUTPUT: output,
      NODE_OPTIONS: `--import=${new URL(`file:///${probe.replaceAll('\\', '/')}`).href}`,
    };
    try {
      await local.exec(installCommand(target, installer, hash));
    } finally {
      local.env = environment;
    }
    const observed = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(observed.execPath.toLowerCase(), resolve(verified).toLowerCase());
    assert.equal(existsSync(verified), false, 'The verified copy is removed after it ran');
  } finally {
    await removeRemoteStage(local, target, stage);
  }
  assert.equal(existsSync(stage), false, 'The stage is removed');
}
