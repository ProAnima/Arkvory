import { win32 } from 'node:path';

/**
 * Archive tool for packaging and deployment checks.
 * On Windows the first `tar` on PATH may be GNU tar from Git/MSYS, which reads `C:\...` as a
 * remote `host:path` and cannot open local archives. Windows ships bsdtar in System32, so the
 * absolute path is used and PATH is ignored. A missing SystemRoot is an environment error, not
 * a reason to fall back to whichever tar happens to be first on PATH.
 */
export function tarExecutable(platform = process.platform, environment = process.env) {
  if (platform !== 'win32') return 'tar';
  const root = Object.entries(environment).find(
    ([name]) => name.toLowerCase() === 'systemroot',
  )?.[1];
  if (typeof root !== 'string' || !/^[A-Za-z]:[\\/]/.test(root))
    throw new Error('SystemRoot must name the local Windows directory to locate System32 tar.exe');
  return win32.join(root, 'System32', 'tar.exe');
}
