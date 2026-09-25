import { execFileSync } from 'node:child_process';
import { mkdtemp, access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

export async function exerciseClient(output, version) {
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  const windows = process.platform === 'win32';
  const directory = await mkdtemp(join(tmpdir(), 'depot-client-install-'));
  const installation = join(directory, 'Depot CLI');
  const env = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'psmodulepath'),
    ),
    DEPOT_CLI_HOME: join(directory, 'profile'),
    DEPOT_CLIENT_SHIM: join(installation, 'depotctl.cmd'),
    DEPOT_CLIENT_UNINSTALL: join(installation, 'unins000.exe'),
  };
  const run = (file, args) =>
    execFileSync(file, args, { env, encoding: 'utf8', windowsHide: true, timeout: 180000 });
  const install = () =>
    windows
      ? run(join(output, 'Depot-CLI-Setup-x64.exe'), [
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
          join(output, 'Depot-CLI-amd64.deb'),
        ]);
  const cli = (args) =>
    windows
      ? run('powershell.exe', [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          '& $env:DEPOT_CLIENT_SHIM ' + args,
        ])
      : run('depotctl', args.split(' '));
  install();
  assert.equal(JSON.parse(cli('--version')).version, version);
  cli('profile add acceptance --server https://depot.example');
  const profile = join(env.DEPOT_CLI_HOME, 'profiles.json');
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
      "$operation = Start-Process -FilePath $env:DEPOT_CLIENT_UNINSTALL -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART' -WindowStyle Hidden -Wait -PassThru; exit $operation.ExitCode",
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
    const dependencies = run('dpkg-deb', ['-f', join(output, 'Depot-CLI-amd64.deb'), 'Depends']);
    assert.doesNotMatch(dependencies, /postgres|systemd/);
    run('sudo', ['apt-get', 'remove', '-y', 'proanima-depot-cli']);
    await assert.rejects(access('/usr/bin/depotctl'), /ENOENT/);
  }
  assert.equal(await readFile(profile, 'utf8'), before);
  console.log('Independent CLI install, bundled runtime, reinstall and retained profiles passed');
}
