import { lstat, readdir, chmod } from 'node:fs/promises';
import { parse } from 'node:path';
import { execFile } from 'node:child_process';
import { command } from './process.js';

const notAdministrator = 3;
const administratorCheck = `if (-not ([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { exit ${String(notAdministrator)} }`;
// Compose talks to the installing user's container engine. Docker Desktop reads bind mounts with
// that user's (UAC-filtered) token, so the root also grants that user, like chmod 0700 on Linux.
const protectRoot = [
  "$grants = @('*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F')",
  "if ($env:ARKVORY_ENGINE_USER -eq 'true') { $grants += '*' + [Security.Principal.WindowsIdentity]::GetCurrent().User.Value + ':(OI)(CI)F' }",
  '& icacls.exe $env:ARKVORY_PROTECT_ROOT /inheritance:r /grant:r @grants | Out-Null',
  'exit $LASTEXITCODE',
].join('; ');

export function windowsAdministrator(): Promise<boolean> {
  // Windows PowerShell 5 must not inherit PowerShell 7's incompatible module search path.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'psmodulepath'),
  );
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', administratorCheck],
      { env, timeout: 60000, windowsHide: true },
      (error) => {
        if (!error) resolve(true);
        else if (error.code === notAdministrator) resolve(false);
        else reject(new Error('Cannot determine Windows elevation'));
      },
    );
  });
}

export async function protectInstallation(root: string, mode: string): Promise<void> {
  if (parse(root).root === root || (await lstat(root)).isSymbolicLink())
    throw new Error('Unsafe installation root');
  const allowed = new Set(['operation.lock', 'github-token.txt', 'runtime', 'releases']);
  for (const entry of await readdir(root)) {
    if (
      !allowed.has(entry) &&
      !/^bootstrap\.[a-zA-Z0-9]+$/.test(entry) &&
      !/^download-[a-f0-9-]+\.zip$/.test(entry)
    )
      throw new Error('Use a dedicated empty installation directory');
  }
  if (process.platform === 'win32') {
    const compose = mode === 'compose';
    if (!compose && !(await windowsAdministrator()))
      throw new Error('Windows service installation requires Administrator');
    await command(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', protectRoot],
      undefined,
      { ARKVORY_PROTECT_ROOT: root, ARKVORY_ENGINE_USER: String(compose) },
    );
  } else await chmod(root, 0o700);
}
