import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export async function exerciseNativeRecovery(root, token, read) {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Recovery requires a disposable runner');
  const windows = process.platform === 'win32';
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'psmodulepath'),
  );
  const run = (file, args) =>
    execFileSync(file, args, {
      env,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 45000,
    }).trim();
  const ps = (script) =>
    run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
  const settings = JSON.parse(await read(join(root, 'database/settings.json')));
  for (const role of ['api', 'worker', 'database']) {
    const name = windows ? `Arkvory${role}` : `arkvory-${role}`;
    const state = () =>
      windows
        ? JSON.parse(
            ps(
              `Get-CimInstance Win32_Service -Filter "Name='${name}'" | Select-Object ProcessId,StartMode,State | ConvertTo-Json -Compress`,
            ),
          )
        : {
            ProcessId: Number(
              run('sudo', ['systemctl', 'show', name, '--property=MainPID', '--value']),
            ),
          };
    const before = state();
    assert.ok(before.ProcessId > 0, `${name} must be running`);
    if (windows) assert.equal(before.StartMode, 'Auto');
    else assert.equal(run('sudo', ['systemctl', 'is-enabled', name]), 'enabled');
    if (role === 'database') {
      const args = [
        '-D',
        join(root, 'database/cluster'),
        'stop',
        '-m',
        'immediate',
        '-w',
        '-t',
        '30',
      ];
      if (windows) run(join(settings.bin, 'pg_ctl.exe'), args);
      else run('sudo', ['-u', 'arkvory-db', join(settings.bin, 'pg_ctl'), ...args]);
    } else if (windows) {
      // Kill only the app child of this exact service wrapper, never unrelated Node processes.
      ps(
        `$children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=${before.ProcessId}" | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*launcher.mjs*' }); if ($children.Count -ne 1) { throw 'Expected one Arkvory application child' }; Stop-Process -Id $children[0].ProcessId -Force`,
      );
    } else run('sudo', ['systemctl', 'kill', '--kill-whom=main', '--signal=SIGKILL', name]);
    let recovered = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      await delay(1000);
      const current = state();
      if (current.ProcessId <= 0 || current.ProcessId === before.ProcessId) continue;
      try {
        const response = await fetch('http://127.0.0.1:8080/health/ready', {
          headers: { Authorization: `Bearer ${token.trim()}` },
          signal: AbortSignal.timeout(2000),
        });
        await response.body?.cancel();
        if (response.ok) {
          recovered = true;
          break;
        }
      } catch {}
    }
    assert.ok(recovered, `${name} must restart automatically and restore API readiness`);
  }
  console.log('Installed API/worker/database autostart and actual crash recovery passed');
}
