import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { access, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { exerciseBackupAgent } from './backup-acceptance.mjs';
import { requireDisposableHost } from './disposable-host.mjs';

const windows = process.platform === 'win32';

/**
 * The installed backup service (ADR 0057): registered, running and enabled at boot, then
 * `arkvory configure --backup-vault <dir> --init-vault` and one capture through the API.
 */
export async function exerciseInstalledBackup(root, vault, token, run) {
  requireDisposableHost('Native backup agent');
  if (windows) {
    run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "$s = Get-CimInstance Win32_Service -Filter \"Name='Arkvorybackup'\"; if ($s.State -ne 'Running' -or $s.StartMode -ne 'Auto') { throw 'Arkvorybackup must run and start at boot' }; if ($s.StartName -ne 'NT AUTHORITY\\LocalService') { throw 'The backup agent must run as LocalService' }",
    ]);
    await mkdir(vault);
  } else {
    run('sudo', ['systemctl', 'is-active', '--quiet', 'arkvory-backup']);
    run('sudo', ['systemctl', 'is-enabled', '--quiet', 'arkvory-backup']);
    run('sudo', ['mkdir', '-m', '0755', '--', vault]);
  }
  const configure = () =>
    windows
      ? run(join(root, 'runtime/node.exe'), [
          join(root, 'manage.mjs'),
          'configure',
          '--root',
          root,
          '--backup-vault',
          vault,
          '--init-vault',
          '--vault-no-encryption',
        ])
      : run('sudo', [
          'arkvory',
          'configure',
          '--root',
          root,
          '--backup-vault',
          vault,
          '--init-vault',
          '--vault-no-encryption',
        ]);
  const result = await exerciseBackupAgent(token.trim(), async () => {
    configure();
  });
  if (!windows)
    assert.equal(
      execFileSync('sudo', ['stat', '-c', '%U:%G:%a', vault], { encoding: 'utf8' }).trim(),
      'arkvory:arkvory:700',
      'The vault belongs to the service account only',
    );
  await committedPoint(vault, result.pointId);
  return result;
}

export async function committedPoint(vault, pointId) {
  const path = join(vault, 'points', pointId, 'COMMITTED');
  if (windows) await access(path);
  else execFileSync('sudo', ['test', '-f', path]);
}

/** The gate's own vault, at its generated path on the disposable host. */
export async function removeGateVault(vault) {
  requireDisposableHost('Native backup agent');
  if (windows) await rm(vault, { recursive: true, force: true, maxRetries: 3 });
  else execFileSync('sudo', ['rm', '-rf', '--', vault]);
}
