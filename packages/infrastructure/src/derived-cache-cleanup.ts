import { opendir, rmdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { ModuleServiceError } from '@proanima/arkvory-extension-api';
import { hasCode, syncDirectory } from './fs-durability.js';
import { requireInside } from './module-data-paths.js';

/** Bounded, repeatable flat-directory cleanup. Charge is released only after the
 * namespace is gone; deletion never follows a module-controlled path or a link. */
export async function removeCacheGeneration(
  root: string,
  id: string,
  check: () => void,
): Promise<boolean> {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new ModuleServiceError('invalid_input');
  await requireInside(root, [id]);
  const path = join(root, id);
  let directory;
  try {
    directory = await opendir(path);
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return true;
    throw error;
  }
  let count = 0;
  for await (const entry of directory) {
    if (count++ >= 1000) return false;
    if (
      !entry.isFile() ||
      !/^(?:[a-f0-9]{64}|pending-[a-f0-9]{64}|manifest(?:-pending)?)$/.test(entry.name)
    )
      throw new ModuleServiceError('unavailable', 'Invalid cache generation entry');
    check();
    await unlink(join(path, entry.name)).catch((error: unknown) => {
      if (!hasCode(error, 'ENOENT')) throw error;
    });
  }
  check();
  try {
    await rmdir(path);
  } catch (error) {
    if (hasCode(error, 'ENOTEMPTY')) return false;
    if (!hasCode(error, 'ENOENT')) throw error;
  }
  await syncDirectory(root);
  check();
  return true;
}
