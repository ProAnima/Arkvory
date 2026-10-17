import { open } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import {
  MODULE_SET_FILE,
  PACKAGE_LIMITS,
  REVOCATIONS_FILE,
  SigningError,
  keyRing,
  moduleKeys,
  parseModuleSet,
  readRevocations,
  verifyInstalledModule,
} from '@proanima/arkvory-signing';
import type {
  ClassifiedKey,
  InstalledModule,
  ModuleSet,
  RevocationList,
  SigningKey,
} from '@proanima/arkvory-signing';
import { admitPackage } from './module-admission.js';
import type { RefusedModule, VerifiedModule } from './module-admission.js';
import { ModuleAccessError, packageTree, unsafeEntries } from './module-access.js';

/** Where the installed signed modules of the host are and which keys may sign them. */
export interface InstalledModulesSource {
  /** Absolute `modules/` directory of the installation root (ADR 0078, section 4). */
  readonly directory: string;
  /** Absolute path of the stored revocation list; a missing file means no list yet. */
  readonly revocationsFile: string;
  /**
   * ProAnimaStudio module keys. The services always use the keys built into the release; tests
   * pass throwaway keys here, so the production keys are never needed to test the loader.
   */
  readonly keys: readonly SigningKey[];
}

export interface InstalledModules {
  readonly verified: readonly VerifiedModule[];
  readonly refused: readonly RefusedModule[];
}

/** What the loading core is: its versions and clock, as `verifyInstalledModule` needs them. */
export interface LoadingHost {
  readonly coreVersion: string;
  readonly extensionApi: string;
  readonly now: number;
}

/**
 * `ARKVORY_MODULES_DIR` and `ARKVORY_MODULE_REVOCATIONS_FILE`, set by the service launcher for
 * the installation root; without the directory no signed module is loaded (Compose, development).
 * Both paths are absolute, like ARKVORY_MODULES_FILE.
 */
export function installedModulesFrom(env: NodeJS.ProcessEnv): InstalledModulesSource | undefined {
  const directory = env['ARKVORY_MODULES_DIR'];
  if (directory === undefined || directory === '') return undefined;
  const revocationsFile =
    env['ARKVORY_MODULE_REVOCATIONS_FILE'] ?? join(dirname(directory), 'config', REVOCATIONS_FILE);
  if (!isAbsolute(directory) || !isAbsolute(revocationsFile))
    throw new Error('ARKVORY_MODULES_DIR and ARKVORY_MODULE_REVOCATIONS_FILE must be absolute');
  return { directory, revocationsFile, keys: moduleKeys };
}

const missing = (error: unknown) =>
  error instanceof Error &&
  'code' in error &&
  (error.code === 'ENOENT' || error.code === 'ENOTDIR');

/** A host-written file read at most `limit` bytes far; null when it does not exist. */
async function bounded(path: string, limit: number): Promise<string | null> {
  let handle;
  try {
    handle = await open(path, 'r');
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > limit) throw new Error('Module file too large');
    return await handle.readFile('utf8');
  } finally {
    await handle.close();
  }
}

/**
 * The set the host tool wrote. A set that cannot be read stops the start, as an unreadable
 * ARKVORY_MODULES_FILE does: the processes of the installation must plan the same modules.
 */
async function readSet(directory: string): Promise<ModuleSet> {
  let text: string | null;
  try {
    text = await bounded(join(directory, MODULE_SET_FILE), PACKAGE_LIMITS.manifestBytes);
    return text === null
      ? { format: 1, modules: [], retained: [] }
      : parseModuleSet(JSON.parse(text));
  } catch (error) {
    throw new Error('Invalid modules/installed.json', { cause: error });
  }
}

const refuseAll = (set: ModuleSet, code: string): InstalledModules => ({
  verified: [],
  refused: set.modules.map((m) => refusal(m, 'failed', code)),
});

/** Every path the access check covers: shared files first, then each package tree. */
async function accessPaths(source: InstalledModulesSource, set: ModuleSet) {
  const shared = [source.directory, join(source.directory, MODULE_SET_FILE)];
  if ((await bounded(source.revocationsFile, PACKAGE_LIMITS.revocationsBytes)) !== null)
    shared.push(source.revocationsFile);
  const trees = new Map<string, string[] | ModuleAccessError | 'missing'>();
  for (const m of set.modules) {
    const parent = join(source.directory, m.id);
    try {
      const tree = await packageTree(join(parent, m.version));
      trees.set(m.id, [parent, ...tree]);
    } catch (error) {
      if (missing(error)) trees.set(m.id, 'missing');
      else if (error instanceof ModuleAccessError) trees.set(m.id, error);
      else throw error;
    }
  }
  return { shared, trees };
}

/** The stored list verified again, or the code that refuses every module without one. */
async function revocations(
  file: string,
  ring: readonly ClassifiedKey[],
): Promise<RevocationList | null | 'revocations_invalid'> {
  try {
    const text = await bounded(file, PACKAGE_LIMITS.revocationsBytes);
    return text === null ? null : readRevocations(text, ring);
  } catch {
    // A list that no longer verifies may hide revocations: fail closed for every module.
    return 'revocations_invalid';
  }
}

/** One package: verified again, then admitted or refused by `admitPackage`. */
async function checkPackage(
  source: InstalledModulesSource,
  entry: InstalledModule,
  host: LoadingHost & { readonly keys: readonly ClassifiedKey[] },
  list: RevocationList | null,
): Promise<VerifiedModule | RefusedModule> {
  const directory = join(source.directory, entry.id, entry.version);
  try {
    const signed = await verifyInstalledModule(directory, host, 'load');
    return admitPackage(entry, signed, list, directory);
  } catch (error) {
    if (missing(error)) return refusal(entry, 'unavailable', 'module_unavailable');
    if (error instanceof SigningError) return refusal(entry, 'failed', error.code);
    throw error;
  }
}

function refusal(
  entry: InstalledModule,
  status: RefusedModule['status'],
  code: string,
): RefusedModule {
  return {
    id: entry.id,
    version: entry.version,
    kind: null,
    roles: [],
    enabled: false,
    status,
    code,
  };
}

/** The refusal of a package whose tree is missing, has links or may be changed by others. */
function accessRefusal(
  entry: InstalledModule,
  tree: string[] | ModuleAccessError | 'missing' | undefined,
  unsafe: ReadonlySet<string>,
): RefusedModule | null {
  if (tree === 'missing') return refusal(entry, 'unavailable', 'module_unavailable');
  if (tree === undefined) return refusal(entry, 'failed', 'access_unverified');
  if (tree instanceof ModuleAccessError) return refusal(entry, 'failed', tree.code);
  return tree.some((path) => unsafe.has(path)) ? refusal(entry, 'failed', 'access_unsafe') : null;
}

/**
 * Reads the installed signed modules and checks each before any of its code is imported
 * (ADR 0078, 3.3, step 2): the access of the module directory, then `verifyInstalledModule`
 * (signature, manifest, signer, every file, compatibility), then the installed entry, the
 * revocation list and the roles (`admitPackage`). Every refusal is per module and fails closed:
 * the module is not planned and the others are unaffected. A stale or missing revocation list
 * does not refuse anything; a list that no longer verifies refuses every module.
 */
export async function checkInstalledModules(
  source: InstalledModulesSource,
  host: LoadingHost,
): Promise<InstalledModules> {
  const set = await readSet(source.directory);
  if (set.modules.length === 0) return { verified: [], refused: [] };
  const keys = keyRing({ module: source.keys });
  const { shared, trees } = await accessPaths(source, set);
  const all = [...shared, ...[...trees.values()].flatMap((t) => (Array.isArray(t) ? t : []))];
  let unsafe: ReadonlySet<string>;
  try {
    unsafe = await unsafeEntries(all, dirname(source.directory));
  } catch (error) {
    if (error instanceof ModuleAccessError) return refuseAll(set, error.code);
    throw error;
  }
  if (shared.some((path) => unsafe.has(path))) return refuseAll(set, 'access_unsafe');
  const list = await revocations(source.revocationsFile, keys);
  if (list === 'revocations_invalid') return refuseAll(set, list);
  const verified: VerifiedModule[] = [];
  const refused: RefusedModule[] = [];
  for (const entry of set.modules) {
    const result =
      accessRefusal(entry, trees.get(entry.id), unsafe) ??
      (await checkPackage(source, entry, { ...host, keys }, list));
    if ('manifest' in result) verified.push(result);
    else refused.push(result);
  }
  return { verified, refused };
}
