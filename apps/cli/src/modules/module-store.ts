import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EXTENSION_API_VERSION, MODULE_ID_PATTERN } from '@proanima/arkvory-extension-api';
import { REVOCATIONS_FILE, keyRing, moduleKeys, readRevocations } from '@proanima/arkvory-signing';
import type { PackageHost, RevocationList, SigningKey } from '@proanima/arkvory-signing';
import { record, text } from '@proanima/arkvory-contracts';
import { CliError } from '../errors.js';
import { cliHome } from '../profiles.js';
import { exists, isMissing, readJson, saveJson } from '../local-files.js';

/**
 * A client module installed for this user (ADR 0079, 5.11): one version per id, enabled for
 * every profile (`*`), for the named profiles, or for none (`[]`, the state after install).
 */
export interface ClientModuleEntry {
  readonly id: string;
  readonly version: string;
  /** SHA-256 of the package archive that was installed. */
  readonly sha256: string;
  readonly keyId: string;
  readonly kind: string;
  readonly enabledFor: '*' | readonly string[];
  readonly installedAt: string;
}

export interface ClientModuleSet {
  readonly format: 1;
  readonly modules: readonly ClientModuleEntry[];
}

/**
 * `<CLI home>/modules/`: `installed.json`, the unpacked packages `<id>/<version>/`, the newest
 * verified revocation list and `.staging/` for files of an unfinished command. Written only by
 * `arkvoryctl module` as the user; names with a dot are never module ids.
 */
export function moduleLayout(home = cliHome()) {
  const directory = join(home, 'modules');
  return {
    directory,
    set: join(directory, 'installed.json'),
    revocations: join(directory, REVOCATIONS_FILE),
    staging: join(directory, '.staging'),
    unpacked: (id: string, version: string) => join(directory, id, version),
  };
}

export type ModuleLayout = ReturnType<typeof moduleLayout>;

const DIGEST = /^[0-9a-f]{64}$/;
const KEY_ID = /^[0-9a-f]{16}$/;
const PROFILE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const KIND = /^[a-z][a-z0-9-]{1,31}$/;
const VERSION = /^[0-9a-z.+-]{5,64}$/;

function field(row: Record<string, unknown>, key: string, pattern: RegExp): string {
  const value = text(row[key]);
  if (!pattern.test(value)) throw new CliError('invalid_module_set', 7);
  return value;
}

function entry(value: unknown): ClientModuleEntry {
  const row = record(value);
  const enabled = row['enabledFor'];
  const enabledFor =
    enabled === '*'
      ? '*'
      : Array.isArray(enabled) &&
          enabled.every((name: unknown) => typeof name === 'string' && PROFILE.test(name))
        ? enabled.map(text)
        : null;
  if (enabledFor === null || !Number.isFinite(Date.parse(text(row['installedAt']))))
    throw new CliError('invalid_module_set', 7);
  return {
    id: field(row, 'id', MODULE_ID_PATTERN),
    version: field(row, 'version', VERSION),
    sha256: field(row, 'sha256', DIGEST),
    keyId: field(row, 'keyId', KEY_ID),
    kind: field(row, 'kind', KIND),
    enabledFor,
    installedAt: text(row['installedAt']),
  };
}

/** The installed set; none yet is an empty set. Anything malformed refuses every module. */
export async function readModuleSet(layout: ModuleLayout): Promise<ClientModuleSet> {
  if (!(await exists(layout.set))) return { format: 1, modules: [] };
  try {
    const row = record(await readJson(layout.set));
    if (row['format'] !== 1 || !Array.isArray(row['modules'])) throw new Error('format');
    const modules = row['modules'].map((value: unknown) => entry(value));
    if (new Set(modules.map((m) => m.id)).size !== modules.length) throw new Error('duplicate');
    return { format: 1, modules };
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError('invalid_module_set', 7);
  }
}

export async function writeModuleSet(layout: ModuleLayout, set: ClientModuleSet): Promise<void> {
  const modules = [...set.modules].sort((a, b) => (a.id < b.id ? -1 : 1));
  await saveJson(layout.set, { format: 1, modules });
}

/** Whether a module runs for `profile` ('' when no profile is used, as in CI). */
export function enabledFor(module: ClientModuleEntry, profile: string): boolean {
  return module.enabledFor === '*' || (profile !== '' && module.enabledFor.includes(profile));
}

/**
 * The verifying host of `arkvoryctl`: client packages only, ProAnimaStudio module keys only
 * (no operator or other keys; ADR 0078, 3.2), the extension API and release of this client.
 * Tests pass throwaway keys; the release has no way to add keys from the environment.
 */
export function clientHost(
  keys: readonly SigningKey[] = moduleKeys,
  now: number = Date.now(),
): PackageHost {
  return {
    keys: keyRing({ module: keys }),
    extensionApi: EXTENSION_API_VERSION,
    coreVersion: process.env['ARKVORY_CLI_VERSION'] ?? 'development',
    now,
    side: 'client',
  };
}

/**
 * The stored revocation list, verified at every read. A list the keys no longer verify refuses
 * every module (`revocations_invalid`): it could hide a revocation.
 */
export async function readStoredRevocations(
  layout: ModuleLayout,
  host: PackageHost,
): Promise<RevocationList | null> {
  let envelope: string;
  try {
    envelope = await readFile(layout.revocations, 'utf8');
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
  return readRevocations(envelope, host.keys);
}
