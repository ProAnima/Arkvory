import { lstat } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { ModuleAccessError, packageTree, unsafeForUser } from '@proanima/arkvory-signing';
import { CliError } from '../errors.js';
import { exists, isMissing } from '../local-files.js';
import type { ModuleLayout } from './module-store.js';

/*
 * Who may change what `arkvoryctl` is about to trust (ADR 0079, 5.11). The CLI folder, the
 * modules folder, `installed.json`, the stored revocation list and, per module, every folder
 * from the modules folder down to the package and every entry of the package must be
 * changeable by this user (or root, or the Windows host administrators) only, and none may be
 * a link or a junction: otherwise another account could enable a module, put an older
 * revocation list back, or replace a package between the check and the import
 * (`module_access`). Windows access rules are read and classified by the same code as the
 * server loader's (`unsafeForUser`, ADR 0078, 3.3); a check that cannot run there is
 * `module_access_unverified` and loads nothing.
 */

async function unsafePaths(paths: readonly string[]): Promise<ReadonlyMap<string, string>> {
  try {
    return await unsafeForUser(paths);
  } catch (error) {
    if (error instanceof ModuleAccessError && error.code === 'access_unverified')
      throw new CliError('module_access_unverified', 7);
    throw error;
  }
}

/** A path that is itself a regular file or folder, never a link, junction or device. */
async function plain(path: string): Promise<boolean> {
  const info = await lstat(path);
  return !info.isSymbolicLink() && (info.isDirectory() || info.isFile());
}

/** The shared files, checked before they are read; any problem refuses every module. */
export async function checkSharedAccess(layout: ModuleLayout): Promise<void> {
  const paths = [dirname(layout.directory), layout.directory];
  for (const file of [layout.set, layout.revocations]) if (await exists(file)) paths.push(file);
  for (const path of paths) if (!(await plain(path))) throw new CliError('module_access', 7);
  if ((await unsafePaths(paths)).size > 0) throw new CliError('module_access', 7);
}

/**
 * Each package's folders between the modules folder and it and its whole tree, checked in
 * one pass. Returns the code of each package directory that failed (`module_access`, or
 * `module_unavailable` when it is gone); the others passed.
 */
export async function checkPackageAccess(
  modules: string,
  directories: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  const failed = new Map<string, string>();
  const checked = new Map<string, readonly string[]>();
  for (const directory of directories) {
    const between = relative(modules, directory).split(sep).slice(0, -1);
    const parents = between.map((_, index) => join(modules, ...between.slice(0, index + 1)));
    try {
      const linked = await Promise.all(parents.map(async (parent) => !(await plain(parent))));
      if (linked.some(Boolean)) throw new ModuleAccessError('access_link');
      checked.set(directory, [...parents, ...(await packageTree(directory))]);
    } catch (error) {
      if (isMissing(error)) failed.set(directory, 'module_unavailable');
      else if (error instanceof ModuleAccessError) failed.set(directory, 'module_access');
      else throw error;
    }
  }
  const unsafe = await unsafePaths([...new Set([...checked.values()].flat())]);
  for (const [directory, paths] of checked)
    if (paths.some((path) => unsafe.has(path))) failed.set(directory, 'module_access');
  return failed;
}
