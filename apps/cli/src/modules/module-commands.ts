import { randomUUID } from 'node:crypto';
import { copyFile, chmod, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  PACKAGE_LIMITS,
  acceptRevocations,
  extractModulePackage,
  inspectModulePackage,
  newerRevocations,
  readRevocations,
  revocationOf,
  revocationsCurrent,
} from '@proanima/arkvory-signing';
import type { InspectedPackage, PackageHost, RevocationList } from '@proanima/arkvory-signing';
import { CliError, sanitize } from '../errors.js';
import { exclusive, privateDirectory } from '../local-files.js';
import { readModuleSet, readStoredRevocations, writeModuleSet } from './module-store.js';
import type { ClientModuleEntry, ClientModuleSet, ModuleLayout } from './module-store.js';

export interface InstallOptions {
  readonly yes: boolean;
  /** Go on without a current revocation list; the result says so. */
  readonly allowStale: boolean;
}

/** Copies the file into staging first: what is verified is what gets installed. */
async function stage(file: string, layout: ModuleLayout): Promise<string> {
  const info = await lstat(file);
  if (!info.isFile() || info.size > PACKAGE_LIMITS.archiveBytes)
    throw new CliError('invalid_module_package', 7);
  await privateDirectory(layout.staging);
  const staged = join(layout.staging, `${randomUUID()}.tgz`);
  await copyFile(file, staged);
  await chmod(staged, 0o600);
  return staged;
}

/** Keeps a newer verified list; a list never goes back (ADR 0078, 3.4). */
async function keepRevocations(
  layout: ModuleLayout,
  stored: RevocationList | null,
  candidate: RevocationList | null,
): Promise<RevocationList | null> {
  const newer = newerRevocations(stored, candidate);
  if (newer !== null && newer !== stored) {
    acceptRevocations(stored, newer);
    await writeText(layout.revocations, newer.envelope);
  }
  return newer;
}

async function writeText(path: string, content: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { mode: 0o600, flag: 'wx' });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

function describe(inspected: InspectedPackage) {
  const { module } = inspected.manifest;
  return {
    id: module.id,
    version: module.version,
    kind: module.kind,
    keyId: inspected.signer.keyId,
    sha256: inspected.sha256,
    licenseFeature: inspected.manifest.package.licenseFeature,
    // Signed text, still never a control sequence on the terminal.
    terms:
      inspected.terms === null
        ? null
        : {
            text: inspected.terms.text.replace(/[^\P{Cc}\n\t]/gu, ''),
            truncated: inspected.terms.truncated,
          },
  };
}

/** Unpacks the verified package into place and records it; replaces another installed version. */
async function place(
  layout: ModuleLayout,
  staged: string,
  inspected: InspectedPackage,
  set: ClientModuleSet,
  now: number,
): Promise<ClientModuleEntry> {
  const { id, version, kind } = inspected.manifest.module;
  const target = layout.unpacked(id, version);
  const unpacked = join(layout.staging, randomUUID());
  await extractModulePackage(staged, inspected, unpacked);
  await rm(target, { recursive: true, force: true });
  await mkdir(join(layout.directory, id), { recursive: true, mode: 0o755 });
  await rename(unpacked, target);
  const previous = set.modules.find((m) => m.id === id);
  const entry: ClientModuleEntry = {
    id,
    version,
    sha256: inspected.sha256,
    keyId: inspected.signer.keyId,
    kind,
    // A new version keeps where the old one was enabled; a new module starts disabled.
    enabledFor: previous?.enabledFor ?? [],
    installedAt: new Date(now).toISOString(),
  };
  await writeModuleSet(layout, {
    format: 1,
    modules: [...set.modules.filter((m) => m.id !== id), entry],
  });
  if (previous && previous.version !== version)
    await rm(layout.unpacked(id, previous.version), { recursive: true, force: true });
  return entry;
}

/**
 * `arkvoryctl module install FILE [--yes] [--allow-stale-revocations]` (ADR 0079, 5.11): copy,
 * verify as a client package (signature by a ProAnimaStudio module key, manifest, every file,
 * compatibility), keep a newer revocation list the package ships, refuse a revoked version, and
 * without `--yes` only show the module and its terms. Installed modules start disabled.
 */
export async function installModule(
  layout: ModuleLayout,
  file: string,
  options: InstallOptions,
  host: PackageHost,
) {
  await privateDirectory(layout.directory);
  return exclusive(layout.set, async () => {
    const staged = await stage(resolve(file), layout);
    try {
      const inspected = await inspectModulePackage(staged, host, 'install');
      const { id, version } = inspected.manifest.module;
      const stored = await readStoredRevocations(layout, host);
      const revocations = await keepRevocations(layout, stored, inspected.revocations);
      if (revocationOf(revocations, id, version) !== null) throw new CliError('module_revoked', 5);
      const stale = !revocationsCurrent(revocations, host.now);
      if (stale && !options.allowStale) throw new CliError('stale_revocations', 6);
      const module = describe(inspected);
      if (!options.yes) return { installed: false, module, staleRevocations: stale };
      const set = await readModuleSet(layout);
      const entry = await place(layout, staged, inspected, set, host.now);
      return { installed: true, module, enabledFor: entry.enabledFor, staleRevocations: stale };
    } finally {
      await rm(staged, { force: true });
    }
  });
}

/** `module list`: what is installed and where it is enabled; nothing is verified or loaded. */
export async function listModules(layout: ModuleLayout, host: PackageHost) {
  const set = await readModuleSet(layout);
  let list: RevocationList | null = null;
  let revocations: string;
  try {
    list = await readStoredRevocations(layout, host);
    revocations =
      list === null
        ? 'none'
        : revocationsCurrent(list, host.now)
          ? `current until ${list.expiresAt}`
          : `expired at ${list.expiresAt}`;
  } catch {
    revocations = 'invalid';
  }
  return {
    modules: set.modules.map((m) => ({
      ...m,
      revoked: revocationOf(list, m.id, m.version) !== null,
    })),
    revocations,
  };
}

/** `module enable|disable ID [--profile NAME]`: for every profile, or for one. */
export async function setEnabled(
  layout: ModuleLayout,
  id: string,
  enable: boolean,
  profile: string | undefined,
) {
  return exclusive(layout.set, async () => {
    const set = await readModuleSet(layout);
    const module = set.modules.find((m) => m.id === id);
    if (!module) throw new CliError('module_not_installed', 2);
    let enabledFor: ClientModuleEntry['enabledFor'];
    if (profile === undefined) enabledFor = enable ? '*' : [];
    else if (module.enabledFor === '*') {
      if (!enable) throw new CliError('module_enabled_everywhere', 6);
      enabledFor = '*';
    } else
      enabledFor = enable
        ? [...new Set([...module.enabledFor, profile])].sort()
        : module.enabledFor.filter((name) => name !== profile);
    await writeModuleSet(layout, {
      format: 1,
      modules: set.modules.map((m) => (m.id === id ? { ...m, enabledFor } : m)),
    });
    return { module: id, enabledFor };
  });
}

/** `module remove ID`: the package and its entry go; nothing of the server changes. */
export async function removeModule(layout: ModuleLayout, id: string) {
  return exclusive(layout.set, async () => {
    const set = await readModuleSet(layout);
    const module = set.modules.find((m) => m.id === id);
    if (!module) throw new CliError('module_not_installed', 2);
    await writeModuleSet(layout, { format: 1, modules: set.modules.filter((m) => m.id !== id) });
    await rm(join(layout.directory, id), { recursive: true, force: true });
    return { removed: id, version: module.version };
  });
}

/** `module revocations FILE`: a signed list from a file, for clients without the hub. */
export async function applyRevocations(layout: ModuleLayout, file: string, host: PackageHost) {
  await privateDirectory(layout.directory);
  return exclusive(layout.set, async () => {
    const info = await lstat(resolve(file));
    if (!info.isFile() || info.size > PACKAGE_LIMITS.revocationsBytes)
      throw new CliError('invalid_revocations', 7);
    const candidate = readRevocations(await readFile(resolve(file), 'utf8'), host.keys);
    const stored = await readStoredRevocations(layout, host);
    const outcome = acceptRevocations(stored, candidate);
    if (outcome === 'accepted') await writeText(layout.revocations, candidate.envelope);
    return {
      sequence: candidate.sequence,
      stored: outcome === 'accepted',
      current: revocationsCurrent(candidate, host.now),
      expiresAt: sanitize(candidate.expiresAt, 64),
    };
  });
}
