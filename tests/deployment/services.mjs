import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, copyFile, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { requireDisposableHost } from './disposable-host.mjs';
const windows = process.platform === 'win32';
requireDisposableHost('Service acceptance');
// LocalService cannot resolve Node entrypoints through another user's private AppData.
// Match the production installer's machine-wide location instead of the runner's TEMP.
const root = windows
  ? await mkdtemp(join(process.env.ProgramData ?? 'C:\\ProgramData', 'arkvory-service-gate-'))
  : execFileSync('sudo', ['mktemp', '-d', '/opt/arkvory-service-gate-XXXXXX'], {
      encoding: 'utf8',
    }).trim();
if (!windows) execFileSync('sudo', ['chown', `${process.getuid()}:${process.getgid()}`, root]);
if (!windows && process.platform !== 'linux')
  throw Error('Service gate requires Linux systemd or Windows');
const prefix = `arkvorygate${process.pid}`;
const roles = ['api', 'worker', 'backup'];
const environment = { ...process.env };
if (windows)
  for (const key of Object.keys(environment))
    if (key.toLowerCase() === 'psmodulepath') delete environment[key];
const run = (file, args) =>
  execFileSync(file, args, { env: environment, stdio: 'inherit', windowsHide: true });
for (const name of ['data', 'logs', 'config', 'service', 'vault']) await mkdir(join(root, name));
for (const name of ['runtime.json', 'keys.json', 'bootstrap-token.txt', 'postgres.env'])
  await writeFile(join(root, 'config', name), '{}');
await writeFile(join(root, 'github-token.txt'), 'test-only-not-a-real-token');
await copyFile('tests/deployment/service-child.mjs', join(root, 'launcher.mjs'));
const counter = (role) => join(root, role === 'backup' ? 'vault' : 'data', `${role}.starts`);
const readCount = (role) =>
  windows
    ? readFile(counter(role), 'utf8')
    : Promise.resolve(
        execFileSync('sudo', ['cat', counter(role)], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }),
      );
function powershell(script, args) {
  run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...args]);
}
function register() {
  if (windows)
    powershell(resolve('deploy/register-windows.ps1'), [
      '-Root',
      root,
      '-Node',
      process.execPath,
      '-Prefix',
      prefix,
    ]);
  else run('sudo', ['bash', resolve('deploy/register-linux.sh'), root, process.execPath, prefix]);
}
/** The same vault opening that arkvory configure --backup-vault applies (ADR 0057). */
function openVault() {
  if (windows)
    powershell(resolve('deploy/backup-vault-windows.ps1'), ['-Vault', join(root, 'vault')]);
  else
    run('sudo', [
      'bash',
      resolve('deploy/backup-vault-linux.sh'),
      root,
      join(root, 'vault'),
      prefix,
    ]);
}
try {
  register();
  openVault();
  // Repair must restore persisted boot/recovery settings, not merely rewrite configuration files.
  for (const role of roles) {
    if (windows) {
      run('sc.exe', ['config', `${prefix}${role}`, 'start=', 'demand']);
      run('sc.exe', ['failure', `${prefix}${role}`, 'reset=', '0', 'actions=', 'none/0']);
    } else run('sudo', ['systemctl', 'disable', `${prefix}-${role}`]);
  }
  register();
  for (const role of roles) {
    if (windows)
      run('powershell.exe', [
        '-NoProfile',
        '-Command',
        `if ((Get-CimInstance Win32_Service -Filter "Name='${prefix}${role}'").StartMode -ne 'Auto') { throw 'Service must start at boot' }`,
      ]);
    else run('sudo', ['systemctl', 'is-enabled', `${prefix}-${role}`]);
    if (windows) run(join(root, `service/arkvory-${role}.exe`), ['start']);
    else run('sudo', ['systemctl', 'start', `${prefix}-${role}`]);
  }
  let recovered = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    await delay(2000);
    try {
      const counts = await Promise.all(roles.map(readCount));
      if (counts.every((value) => Number(value) >= 4)) {
        recovered = true;
        break;
      }
    } catch (error) {
      if (error.code !== 'ENOENT' && error.status !== 1) throw error;
    }
  }
  assert.ok(recovered, 'Every service process must recover after three consecutive crashes');
  for (const role of roles) {
    if (windows) run(join(root, `service/arkvory-${role}.exe`), ['stopwait']);
    else run('sudo', ['systemctl', 'stop', `${prefix}-${role}`]);
  }
  await delay(12000);
  for (const role of roles)
    assert.equal(
      Number(await readCount(role)),
      4,
      'Explicit maintenance stop must suppress recovery',
    );
  console.log(
    'Native autostart repair, three consecutive crashes and deliberate stop passed for API, worker and backup agent',
  );
} finally {
  if (windows) {
    for (const directory of ['logs', 'service'])
      for (const name of await readdir(join(root, directory)))
        if (name.endsWith('.log'))
          console.log(name, (await readFile(join(root, directory, name), 'utf8')).slice(-12000));
    for (const role of roles)
      console.log(role, await readFile(counter(role), 'utf8').catch(() => 'not started'));
  }
  if (!windows)
    run('sudo', [
      'journalctl',
      '--no-pager',
      '-n',
      '45',
      ...roles.flatMap((role) => ['-u', `${prefix}-${role}`]),
    ]);
  for (const role of roles) {
    if (windows) {
      const exe = join(root, `service/arkvory-${role}.exe`);
      if (existsSync(exe)) {
        run('powershell.exe', [
          '-NoProfile',
          '-Command',
          `if ((Get-Service '${prefix}${role}').Status -ne 'Stopped') { & '${exe.replaceAll("'", "''")}' stopwait; if ($LASTEXITCODE -ne 0) { throw 'Cannot stop test service' } }`,
        ]);
        run(exe, ['uninstall']);
      }
    } else {
      run('sudo', ['systemctl', 'disable', '--now', `${prefix}-${role}`]);
      // Exact, generated unit name; never recursively delete an administrator-provided path.
      run('sudo', ['rm', '--', `/etc/systemd/system/${prefix}-${role}.service`]);
    }
  }
  if (!windows) {
    // Only the generated drop-in of this gate's prefix, then its directory if it exists.
    run('sudo', [
      'bash',
      '-c',
      'rm -f -- "$1/arkvory-vault.conf"; [ ! -d "$1" ] || rmdir -- "$1"',
      'cleanup',
      `/etc/systemd/system/${prefix}-backup.service.d`,
    ]);
    run('sudo', ['systemctl', 'daemon-reload']);
  }
}
