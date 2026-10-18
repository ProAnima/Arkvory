import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { CliError } from '../errors.js';

/**
 * Who may change the code `arkvoryctl` is about to import. On POSIX every directory from the
 * modules directory down to each file of the package must be owned by this user and writable
 * by no group or other user, and none may be a link: otherwise another account could replace
 * the package between the check and the import, or plant code the signature check never saw
 * (`module_access`). Windows keeps a profile private to its user by default; ACLs are not read
 * there, which is the documented limit of client modules on Windows.
 */
export async function checkModuleAccess(modules: string, packageDirectory: string): Promise<void> {
  if (process.platform === 'win32') {
    for (const path of [modules, packageDirectory])
      if ((await lstat(path)).isSymbolicLink()) throw new CliError('module_access', 7);
    return;
  }
  const uid = process.getuid?.();
  const owned = async (path: string) => {
    const info = await lstat(path);
    if (info.isSymbolicLink() || (uid !== undefined && info.uid !== uid) || info.mode & 0o022)
      throw new CliError('module_access', 7);
    return info;
  };
  await owned(modules);
  const relative = packageDirectory.slice(modules.length).split(/[\\/]/).filter(Boolean);
  let path = modules;
  for (const part of relative) {
    path = join(path, part);
    await owned(path);
  }
  const pending = [packageDirectory];
  while (pending.length) {
    const directory = pending.pop() ?? packageDirectory;
    for (const item of await readdir(directory)) {
      const info = await owned(join(directory, item));
      if (info.isDirectory()) pending.push(join(directory, item));
    }
  }
}
