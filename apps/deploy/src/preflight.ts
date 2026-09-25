import { lstat, readdir, chmod } from 'node:fs/promises';
import { parse } from 'node:path';
import { command } from './process.js';

export async function protectInstallation(root: string): Promise<void> {
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
    await command('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'if (-not ([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { exit 1 }',
    ]);
    await command('icacls.exe', [
      root,
      '/inheritance:r',
      '/grant:r',
      '*S-1-5-18:(OI)(CI)F',
      '*S-1-5-32-544:(OI)(CI)F',
    ]);
  } else await chmod(root, 0o700);
}
