import { execFileSync } from 'node:child_process';
import { mkdtemp, access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { requireDisposableHost } from './disposable-host.mjs';

export async function exerciseClient(output, version) {
  requireDisposableHost('Client installation');
  const windows = process.platform === 'win32';
  const directory = await mkdtemp(join(tmpdir(), 'arkvory-client-install-'));
  const installation = join(directory, 'Arkvory CLI');
  const env = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'psmodulepath'),
    ),
    ARKVORY_CLI_HOME: join(directory, 'profile'),
    ARKVORY_CLIENT_SHIM: join(installation, 'arkvoryctl.cmd'),
    ARKVORY_CLIENT_UNINSTALL: join(installation, 'unins000.exe'),
  };
  const run = (file, args) =>
    execFileSync(file, args, { env, encoding: 'utf8', windowsHide: true, timeout: 180000 });
  const install = () =>
    windows
      ? run(join(output, 'Arkvory-CLI-Setup-x64.exe'), [
          '/VERYSILENT',
          '/SUPPRESSMSGBOXES',
          '/NORESTART',
          `/DIR=${installation}`,
        ])
      : run('sudo', [
          'apt-get',
          'install',
          '--reinstall',
          '-y',
          join(output, 'Arkvory-CLI-amd64.deb'),
        ]);
  const cli = (args) =>
    windows
      ? run('powershell.exe', [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          '& $env:ARKVORY_CLIENT_SHIM ' + args,
        ])
      : run('arkvoryctl', args.split(' '));
  install();
  const remoteHelp = windows
    ? run(join(installation, 'node.exe'), [join(installation, 'arkvory-remote.mjs'), '--help'])
    : run('/usr/bin/arkvory-remote', ['--help']);
  assert.match(remoteHelp, /Remote Setup/);
  assert.equal(JSON.parse(cli('--version')).version, version);
  cli('profile add acceptance --server https://arkvory.example');
  const profile = join(env.ARKVORY_CLI_HOME, 'profiles.json');
  const before = await readFile(profile, 'utf8');
  install();
  assert.equal(JSON.parse(cli('profile list --json')).active, 'acceptance');
  if (windows) {
    // A new terminal receives the changed user PATH without touching the machine-wide PATH.
    const path = run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "[Environment]::GetEnvironmentVariable('Path','User')",
    ]);
    assert.equal(
      path.split(';').filter((p) => p.trim().toLowerCase() === installation.toLowerCase()).length,
      1,
    );
    // Inno 6.7.3 terminates its first phase before usPostUninstall runs in the clone.
    // Wait for the process tree, then assert real removal; a parent exit code is insufficient.
    run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "$operation = Start-Process -FilePath $env:ARKVORY_CLIENT_UNINSTALL -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART' -WindowStyle Hidden -Wait -PassThru; exit $operation.ExitCode",
    ]);
    const after = run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "[Environment]::GetEnvironmentVariable('Path','User')",
    ]);
    assert.equal(after.toLowerCase().includes(installation.toLowerCase()), false);
    await assert.rejects(access(join(installation, 'node.exe')), /ENOENT/);
  } else {
    const dependencies = run('dpkg-deb', ['-f', join(output, 'Arkvory-CLI-amd64.deb'), 'Depends']);
    assert.doesNotMatch(dependencies, /postgres|systemd/);
    run('sudo', ['apt-get', 'remove', '-y', 'proanima-arkvory-cli']);
    await assert.rejects(access('/usr/bin/arkvoryctl'), /ENOENT/);
  }
  assert.equal(await readFile(profile, 'utf8'), before);
  console.log('Independent CLI install, bundled runtime, reinstall and retained profiles passed');
}
