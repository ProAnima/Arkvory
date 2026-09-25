import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, copyFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
const windows = process.platform === 'win32';
const root = windows
  ? await mkdtemp(join(tmpdir(), 'depot-service-gate-'))
  : execFileSync('sudo', ['mktemp', '-d', '/opt/depot-service-gate-XXXXXX'], {
      encoding: 'utf8',
    }).trim();
if (!windows) execFileSync('sudo', ['chown', `${process.getuid()}:${process.getgid()}`, root]);
if (!windows && process.platform !== 'linux')
  throw Error('Service gate requires Linux systemd or Windows');
const prefix = `depotgate${process.pid}`;
const environment = { ...process.env };
if (windows) delete environment.PSModulePath;
const run = (file, args) =>
  execFileSync(file, args, { env: environment, stdio: 'inherit', windowsHide: true });
for (const name of ['data', 'logs', 'config', 'service']) await mkdir(join(root, name));
for (const name of ['runtime.json', 'keys.json', 'bootstrap-token.txt', 'postgres.env'])
  await writeFile(join(root, 'config', name), '{}');
await copyFile('tests/deployment/service-child.mjs', join(root, 'launcher.mjs'));
try {
  if (windows)
    run('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      resolve('deploy/register-windows.ps1'),
      '-Root',
      root,
      '-Node',
      process.execPath,
      '-Prefix',
      prefix,
    ]);
  else run('sudo', ['bash', resolve('deploy/register-linux.sh'), root, process.execPath, prefix]);
  for (const role of ['api', 'worker']) {
    if (windows) run(join(root, `service/depot-${role}.exe`), ['start']);
    else run('sudo', ['systemctl', 'start', `${prefix}-${role}`]);
  }
  let recovered = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    await delay(2000);
    try {
      const counts = await Promise.all(
        ['api', 'worker'].map((role) =>
          windows
            ? readFile(join(root, 'data', `${role}.starts`), 'utf8')
            : Promise.resolve(
                execFileSync('sudo', ['cat', join(root, 'data', `${role}.starts`)], {
                  encoding: 'utf8',
                  stdio: ['ignore', 'pipe', 'ignore'],
                }),
              ),
        ),
      );
      if (counts.every((value) => Number(value) >= 2)) {
        recovered = true;
        break;
      }
    } catch (error) {
      if (error.code !== 'ENOENT' && error.status !== 1) throw error;
    }
  }
  assert.ok(recovered, 'Both service processes must restart after an actual crash');
  console.log('Native supervisor restarted both crashed processes');
} finally {
  if (!windows)
    run('sudo', [
      'journalctl',
      '--no-pager',
      '-n',
      '30',
      '-u',
      `${prefix}-api`,
      '-u',
      `${prefix}-worker`,
    ]);
  for (const role of ['api', 'worker']) {
    if (windows) {
      const exe = join(root, `service/depot-${role}.exe`);
      if (existsSync(exe)) {
        run(exe, ['stop']);
        run(exe, ['uninstall']);
      }
    } else {
      run('sudo', ['systemctl', 'disable', '--now', `${prefix}-${role}`]);
      // Exact, generated unit name; never recursively delete an administrator-provided path.
      run('sudo', ['rm', '--', `/etc/systemd/system/${prefix}-${role}.service`]);
    }
  }
  if (!windows) run('sudo', ['systemctl', 'daemon-reload']);
}
