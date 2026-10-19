import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MODULE_SET_FILE, PACKAGE_LIMITS, parseModuleSet } from '@proanima/arkvory-signing';
import type { LicenceModuleRef } from '@proanima/arkvory-application';

/** The hub takes at most 32 modules in a licence request. */
const MAX_MODULES = 32;

/**
 * The installed ProAnimaStudio modules as activation and refresh requests name them (ADR 0078,
 * R2: "id и версии установленных платных модулей"): id and version only, from
 * `modules/installed.json`. Without a modules directory (Compose, tests) the list is empty.
 */
export async function installedLicenceModules(
  directory: string | undefined,
): Promise<readonly LicenceModuleRef[]> {
  if (directory === undefined || directory === '') return [];
  let text: string;
  try {
    text = await readFile(join(directory, MODULE_SET_FILE), 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }
  if (text.length > PACKAGE_LIMITS.manifestBytes) throw new Error('Invalid modules/installed.json');
  // Every module of the set is signed by ProAnimaStudio; operator plugins are not in it.
  return parseModuleSet(JSON.parse(text))
    .modules.slice(0, MAX_MODULES)
    .map((module) => ({ id: module.id, version: module.version }));
}
