import type { TransferExtension } from '@proanima/arkvory-extension-api';
import {
  CLIENT_ENTRY,
  SigningError,
  revocationOf,
  verifyInstalledModule,
} from '@proanima/arkvory-signing';
import type { PackageHost } from '@proanima/arkvory-signing';
import { CliError } from '../errors.js';
import { checkPackageAccess, checkSharedAccess } from './module-access.js';
import { ClientLoadError, importClientModule } from './module-import.js';
import {
  clientHost,
  enabledFor,
  moduleLayout,
  readModuleSet,
  readStoredRevocations,
} from './module-store.js';
import type { ClientModuleEntry, ModuleLayout } from './module-store.js';

/** A module that is enabled but was not loaded, with the machine code of the reason. */
export interface RefusedModule {
  readonly id: string;
  readonly version: string;
  readonly code: string;
}

export interface LoadedModules {
  readonly extensions: readonly TransferExtension[];
  readonly loaded: readonly { readonly id: string; readonly version: string }[];
  readonly refused: readonly RefusedModule[];
}

function codeOf(error: unknown): string {
  if (error instanceof SigningError || error instanceof ClientLoadError) return error.code;
  if (error instanceof CliError) return error.code;
  if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
    return 'module_unavailable';
  return 'module_failed';
}

async function loadOne(
  layout: ModuleLayout,
  module: ClientModuleEntry,
  host: PackageHost,
  context: { readonly signal: AbortSignal; readonly clientVersion: string },
  revoked: (id: string, version: string) => boolean,
): Promise<readonly TransferExtension[]> {
  // The caller checked access first: while only this user can change the files, nobody else
  // changes them between the hash check and the import.
  const directory = layout.unpacked(module.id, module.version);
  const signed = await verifyInstalledModule(directory, host, 'load');
  const { manifest } = signed;
  if (
    manifest.module.id !== module.id ||
    manifest.module.version !== module.version ||
    signed.signer.keyId !== module.keyId
  )
    throw new CliError('installed_mismatch', 7);
  if (revoked(module.id, module.version)) throw new CliError('module_revoked', 7);
  if (manifest.module.kind !== 'transfer') throw new CliError('kind_unsupported', 7);
  const entry = manifest.package.entry[CLIENT_ENTRY];
  if (entry === undefined) throw new CliError('installed_mismatch', 7);
  return importClientModule(directory, entry, manifest.module, context);
}

/**
 * The transfer extensions of the client modules enabled for `profile` (ADR 0079, 5.11). Each
 * enabled module is checked before any of its code runs — access, signature by a ProAnimaStudio
 * module key, every file's SHA-256, compatibility, revocation — and a refused or failing module
 * is reported and left out, never loaded; the others are not affected. Modules that are not
 * enabled are not read at all.
 */
export async function loadClientModules(
  profile: string,
  signal: AbortSignal,
  options: { readonly home?: string; readonly host?: PackageHost } = {},
): Promise<LoadedModules> {
  const layout = moduleLayout(options.home);
  // Nothing enabled: nothing is trusted, so nothing needs checking (no access check runs).
  const first = await readModuleSet(layout);
  if (!first.modules.some((module) => enabledFor(module, profile))) return NONE;
  let enabled: readonly ClientModuleEntry[] = first.modules.filter((m) => enabledFor(m, profile));
  const refuseAll = (error: unknown): LoadedModules => ({
    extensions: [],
    loaded: [],
    refused: enabled.map((m) => ({ id: m.id, version: m.version, code: codeOf(error) })),
  });
  const host = options.host ?? clientHost();
  let revoked: (id: string, version: string) => boolean;
  let failed: ReadonlyMap<string, string>;
  try {
    await checkSharedAccess(layout);
    // Read again after the check: what is used is what nobody else could change.
    enabled = (await readModuleSet(layout)).modules.filter((m) => enabledFor(m, profile));
    // A list the keys no longer verify could hide a revocation: nothing is loaded.
    const list = await readStoredRevocations(layout, host);
    revoked = (id, version) => revocationOf(list, id, version) !== null;
    failed = await checkPackageAccess(
      layout.directory,
      enabled.map((m) => layout.unpacked(m.id, m.version)),
    );
  } catch (error) {
    return refuseAll(error);
  }
  const context = { signal, clientVersion: process.env['ARKVORY_CLI_VERSION'] ?? 'development' };
  const extensions: TransferExtension[] = [];
  const loaded: { id: string; version: string }[] = [];
  const refused: RefusedModule[] = [];
  for (const module of enabled) {
    try {
      const problem = failed.get(layout.unpacked(module.id, module.version));
      if (problem !== undefined) throw new CliError(problem, 7);
      extensions.push(...(await loadOne(layout, module, host, context, revoked)));
      loaded.push({ id: module.id, version: module.version });
    } catch (error) {
      refused.push({ id: module.id, version: module.version, code: codeOf(error) });
    }
  }
  return { extensions, loaded, refused };
}

const NONE: LoadedModules = { extensions: [], loaded: [], refused: [] };
