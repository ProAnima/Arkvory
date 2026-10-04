import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { requireDisposableHost } from './disposable-host.mjs';

export async function exerciseNativeRecovery(root, token, read) {
  requireDisposableHost('Native recovery');
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
  for (const role of ['api', 'worker', 'backup', 'database']) {
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
  console.log('Installed API/worker/backup/database autostart and actual crash recovery passed');
}

/** Opens the inspector of process `pid` and pauses its main thread; its other threads go on. */
async function pauseMainThread(pid, run) {
  if (process.platform === 'win32') run(process.execPath, ['-e', `process._debugProcess(${pid})`]);
  else run('sudo', ['kill', '-USR1', String(pid)]);
  let targets;
  for (let attempt = 0; attempt < 50 && !targets; attempt++) {
    try {
      targets = await (await fetch('http://127.0.0.1:9229/json/list')).json();
    } catch {
      await delay(200);
    }
  }
  assert.ok(targets?.[0], `the inspector of ${String(pid)} did not open`);
  const socket = new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  socket.send(JSON.stringify({ id: 1, method: 'Debugger.enable' }));
  socket.send(JSON.stringify({ id: 2, method: 'Debugger.pause' }));
  return socket;
}

/**
 * A hang, not a crash (ADR 0067): the main thread of each installed service is paused and only
 * its event-loop watchdog (default 60 s) can end it; the service manager restarts it. One at a
 * time: every inspector opens on port 9229.
 */
export async function exerciseNativeHang(token) {
  requireDisposableHost('Native hang recovery');
  const windows = process.platform === 'win32';
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'psmodulepath'),
  );
  const run = (file, args) =>
    execFileSync(file, args, { env, encoding: 'utf8', windowsHide: true, timeout: 45000 }).trim();
  const ps = (script) =>
    run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
  // The application process: the node child of the WinSW wrapper, or the unit's main process.
  const appPid = (name) =>
    windows
      ? Number(
          ps(
            `$service = Get-CimInstance Win32_Service -Filter "Name='${name}'"; @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($service.ProcessId)" | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*launcher.mjs*' })[0].ProcessId`,
          ),
        )
      : Number(run('sudo', ['systemctl', 'show', name, '--property=MainPID', '--value']));
  for (const role of ['api', 'worker', 'backup']) {
    const name = windows ? `Arkvory${role}` : `arkvory-${role}`;
    const before = appPid(name);
    assert.ok(before > 0, `${name} must be running`);
    const socket = await pauseMainThread(before, run);
    let recovered = false;
    for (let attempt = 0; attempt < 150; attempt++) {
      await delay(1000);
      let current = 0;
      try {
        current = appPid(name);
      } catch {}
      if (current <= 0 || current === before) continue;
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
    socket.close();
    assert.ok(recovered, `${name} must be ended by its watchdog and restarted after a hang`);
  }
  console.log(
    'Installed API, worker and backup agent: a hung main thread is ended by the watchdog and the service restarts',
  );
}
