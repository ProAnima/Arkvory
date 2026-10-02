import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';
import { roleCommand, serviceRoles } from '../apps/deploy/dist/runtime.js';
import { shipsBackupRole } from '../apps/deploy/dist/backup-service.js';
import { reportBackupAgent } from '../apps/deploy/dist/backup-probe.js';
import {
  VaultAccess,
  containerVault,
  vaultOverride,
  vaultOverrideFile,
} from '../apps/deploy/dist/vault-access.js';
import { replaceText } from '../apps/deploy/dist/files.js';
import { removeTestDirectory } from './helpers.mjs';

const release = {
  format: 1,
  version: '1.2.3',
  commit: 'a'.repeat(40),
  schema: 26,
  archiveSha256: 'b'.repeat(64),
  setupSha256: 'c'.repeat(64),
};

const installation = (mode) => ({
  format: 1,
  mode,
  engine: 'docker',
  automatic: false,
  pin: null,
  current: release,
});

async function directory(t) {
  const path = await mkdtemp(join(tmpdir(), 'arkvory-backup-role-'));
  t.after(() => removeTestDirectory(path));
  return path;
}

test('the backup agent is a supervised role and vault-init the only launcher command', () => {
  assert.deepEqual(serviceRoles, ['api', 'worker', 'backup']);
  assert.deepEqual(roleCommand('backup'), {
    entry: 'apps/backup/dist/main.js',
    argv: ['agent'],
    service: true,
  });
  const vault = resolve('/srv/arkvory-vault');
  assert.deepEqual(roleCommand('vault-init', [vault]), {
    entry: 'apps/backup/dist/main.js',
    argv: ['vault', 'init', vault],
    service: false,
  });
  assert.equal(roleCommand('migrate').service, false);
  assert.throws(() => roleCommand('vault-init', ['relative']), /absolute/);
  assert.throws(() => roleCommand('vault-init', []), /absolute/);
  assert.throws(() => roleCommand('backup', ['capture']), /no arguments/);
  assert.throws(() => roleCommand('restore'), /Invalid service role/);
});

/** An installation whose release backup entry records how the launcher started it. */
async function launcherFixture(t) {
  const root = await directory(t);
  const release_ = join(root, 'releases', release.version);
  await mkdir(join(release_, 'apps/backup/dist'), { recursive: true });
  await mkdir(join(root, 'config'));
  await writeFile(join(release_, 'package.json'), '{"type":"module"}');
  await writeFile(join(root, 'installation.json'), JSON.stringify(installation('systemd')));
  await writeFile(join(root, 'config/runtime.json'), JSON.stringify({ ARKVORY_DATA_DIR: '/x' }));
  await writeFile(
    join(release_, 'apps/backup/dist/main.js'),
    "import { writeFileSync } from 'node:fs';\n" +
      "writeFileSync(new URL('started.json', import.meta.url), JSON.stringify({ argv: process.argv.slice(2), data: process.env.ARKVORY_DATA_DIR, cwd: process.cwd() }));\n",
  );
  const started = async () =>
    JSON.parse(await readFile(join(release_, 'apps/backup/dist/started.json'), 'utf8'));
  return { root, release: release_, started };
}

test('the launcher runs the agent with its command and the installation environment', async (t) => {
  const { root, release: directory_, started } = await launcherFixture(t);
  const launch = (args) =>
    spawnSync(process.execPath, [resolve('apps/deploy/dist/launch.js'), root, ...args], {
      encoding: 'utf8',
    });
  const agent = launch(['backup']);
  // An agent process that ends without being stopped is a failure for the supervisor.
  assert.equal(agent.status, 1, agent.stderr);
  assert.deepEqual(await started(), { argv: ['agent'], data: '/x', cwd: directory_ });
  const vault = join(root, 'vault');
  const initialize = launch(['vault-init', vault]);
  assert.equal(initialize.status, 0, initialize.stderr);
  assert.deepEqual((await started()).argv, ['vault', 'init', vault]);
  assert.notEqual(launch(['backup', 'restore']).status, 0);
});

test('Compose runs the agent read-only on storage, without keys, ports or the API', async () => {
  const compose = parse(await readFile('deploy/compose.yml', 'utf8'), { merge: true });
  const backup = compose.services.backup;
  assert.deepEqual(backup.command, ['backup']);
  assert.equal(backup.restart, 'unless-stopped');
  assert.equal(backup.read_only, true);
  assert.deepEqual(backup.cap_drop, ['ALL']);
  assert.equal(backup.stop_grace_period, '120s');
  assert.equal(backup.ports, undefined);
  assert.deepEqual(backup.volumes, [
    'storage:/var/lib/arkvory:ro',
    './config/runtime.json:/run/arkvory/runtime.json:ro',
  ]);
  assert.deepEqual(Object.keys(backup.depends_on), ['database']);
  assert.deepEqual(compose.services.backup.logging, compose.services.worker.logging);
  const owner = compose.services['vault-owner'];
  assert.deepEqual(owner.profiles, ['maintenance']);
  assert.equal(owner.network_mode, 'none');
  assert.deepEqual(owner.entrypoint, ['chown', '-R', '1000:1000', containerVault]);
});

test('the vault override bind-mounts an existing host directory and refuses unsafe paths', () => {
  const source = process.platform === 'win32' ? 'D:\\Backup\\Arkvory vault' : '/mnt/backup/a b';
  const override = parse(vaultOverride(source));
  const mount = {
    type: 'bind',
    source,
    target: containerVault,
    bind: { create_host_path: false },
  };
  assert.deepEqual(override.services.backup.volumes, [mount]);
  assert.deepEqual(override.services['vault-owner'].volumes, [mount]);
  for (const unsafe of ["/mnt/it's", '/mnt/${HOME}', '/mnt/a\nb'])
    assert.throws(() => vaultOverride(unsafe), /Unsupported vault path/);
});

test('a Compose vault that cannot be owned leaves no bind mount behind', async (t) => {
  const root = await directory(t);
  await mkdir(join(root, 'config'));
  await mkdir(join(root, 'releases', release.version, 'deploy'), { recursive: true });
  await writeFile(join(root, 'config/runtime.json'), '{}');
  const vault = await directory(t);
  const calls = [];
  const access = new VaultAccess(root, installation('compose'), async (current, args) => {
    calls.push(args.join(' '));
    throw new Error('vault-owner failed');
  });
  // On Windows the ACL step fails first (no script in this release); elsewhere vault-owner.
  await assert.rejects(access.open(vault));
  await assert.rejects(readFile(join(root, vaultOverrideFile)), { code: 'ENOENT' });
  const previous = '# configured earlier\n';
  await writeFile(join(root, vaultOverrideFile), previous);
  await assert.rejects(access.open(vault));
  assert.equal(await readFile(join(root, vaultOverrideFile), 'utf8'), previous);
  if (process.platform !== 'win32')
    assert.deepEqual(calls, ['run --rm --no-deps vault-owner', 'run --rm --no-deps vault-owner']);
  const restore = await access.open(null);
  await assert.rejects(readFile(join(root, vaultOverrideFile)), { code: 'ENOENT' });
  await restore();
  assert.equal(await readFile(join(root, vaultOverrideFile), 'utf8'), previous);
});

test('a release ships the agent role by its entry (native) or service (Compose)', async (t) => {
  const root = await directory(t);
  const deploy = join(root, 'releases', release.version, 'deploy');
  await mkdir(deploy, { recursive: true });
  assert.equal(await shipsBackupRole(root, installation('systemd'), release), false);
  await mkdir(join(root, 'releases', release.version, 'apps/backup/dist'), { recursive: true });
  await writeFile(join(root, 'releases', release.version, 'apps/backup/dist/agent.js'), '');
  assert.equal(await shipsBackupRole(root, installation('windows'), release), true);
  await writeFile(join(deploy, 'compose.yml'), 'services:\n  api: {}\n  worker: {}\n');
  assert.equal(await shipsBackupRole(root, installation('compose'), release), false);
  await copyFile('deploy/compose.yml', join(deploy, 'compose.yml'));
  assert.equal(await shipsBackupRole(root, installation('compose'), release), true);
});

test('configuration replacement keeps the file mode for the service group', async (t) => {
  const root = await directory(t);
  const path = join(root, 'runtime.json');
  await writeFile(path, '{}');
  await chmod(path, 0o640);
  const before = await stat(path);
  await replaceText(path, '{"ARKVORY_PORT":"8080"}\n');
  const after = await stat(path);
  assert.equal(await readFile(path, 'utf8'), '{"ARKVORY_PORT":"8080"}\n');
  assert.equal(after.mode & 0o777, before.mode & 0o777);
  assert.equal(after.uid, before.uid);
  assert.equal(after.gid, before.gid);
});

test('an agent that never comes online is a warning, not a failed installation', async (t) => {
  const lines = [];
  t.mock.method(process.stderr, 'write', (line) => lines.push(String(line)) > 0);
  const offline = async () => ({ agent: { online: false }, vault: { configured: false } });
  await reportBackupAgent(offline, { attempts: 2, intervalMs: 1 });
  await reportBackupAgent(
    async () => {
      throw new Error('HTTP 401');
    },
    { attempts: 1, intervalMs: 1 },
  );
  t.mock.restoreAll();
  assert.match(lines[0], /WARN The backup agent did not come online/);
  assert.equal(lines.length, 2, 'retryable errors end in the same bounded warning');
  assert.match(lines[1], /WARN The backup agent did not come online/);
});
