import { access } from 'node:fs/promises';
import { join } from 'node:path';
import type { Installation, Release } from './model.js';
import { command } from './process.js';
import { windowsAdministrator } from './preflight.js';
import { report } from './output.js';

/**
 * Registers the host updater: a systemd timer, or a SYSTEM task on Windows. Without systemd,
 * root or (for Compose on Windows) elevation, it reports how to schedule `updates-poll` instead.
 */
export async function scheduleUpdater(
  root: string,
  state: Installation,
  release: Release,
): Promise<void> {
  const windows = process.platform === 'win32';
  const manual =
    'Register the host updater as administrator, or schedule updates-poll under the container engine owner.';
  if (!windows) {
    try {
      await access('/run/systemd/system');
    } catch {
      report('warning', 'Host updater needs an external scheduler: run updates-poll every minute.');
      return;
    }
    if (process.getuid?.() !== 0) {
      report('warning', manual);
      return;
    }
  } else if (state.mode === 'compose' && !(await windowsAdministrator())) {
    // Same contract as a docker-group user on Linux: no SYSTEM task without elevation.
    report('warning', manual);
    return;
  }
  const script = join(
    root,
    'releases',
    release.version,
    'deploy',
    windows ? 'schedule-windows.ps1' : 'schedule-linux.sh',
  );
  if (windows)
    await command('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      script,
      '-Root',
      root,
      '-Node',
      process.execPath,
    ]);
  else await command('bash', [script, root, process.execPath]);
}
