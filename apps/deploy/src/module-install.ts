import { randomUUID } from 'node:crypto';
import { chmod, copyFile, lstat, mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import {
  PACKAGE_LIMITS,
  acceptRevocations,
  extractModulePackage,
  inspectModulePackage,
  newerRevocations,
  readRevocations,
  revocationOf,
} from '@proanima/arkvory-signing';
import type { InspectedPackage, RevocationList } from '@proanima/arkvory-signing';
import { atomicJson, jsonFile } from './files.js';
import { parseInstallation } from './model.js';
import type { Installation } from './model.js';
import {
  packageHost,
  readStoredRevocations,
  recordStaleRevocations,
  refuseStaleRevocations,
  revocationsPath,
  staleRevocations,
  writeHostFile,
} from './module-host.js';
import type { ModuleCommandContext } from './module-host.js';
import {
  discardUnreferenced,
  moduleLayout,
  prepareModuleDirectories,
  readModuleSet,
  writeModuleSet,
} from './module-store.js';
import type { InstalledModule, ModuleSet } from './module-store.js';
import { compareVersions } from './module-version.js';
import { checkJournal } from './operations.js';

export async function installation(root: string): Promise<Installation> {
  return parseInstallation(await jsonFile(join(root, 'installation.json')));
}

/**
 * A change of the module set is a record of the update journal (ADR 0059, ADR 0078 section 4)
 * with the release unchanged and `modules.before/after`, and `modules.retained`, what the set
 * before kept, so that `recover` keeps it too. The set file is replaced atomically, so `recover`
 * after an interruption only has to put the previous set back. No service is restarted: the
 * services read the set at their next start (ADR 0079, X4), where a new module stays disabled
 * until ARKVORY_MODULES_FILE enables it; restart and rollback by readiness come with stage O2.
 */
async function changeSet(
  root: string,
  state: Installation,
  before: ModuleSet,
  after: ModuleSet,
  staleRevocations = false,
): Promise<void> {
  const modules = { before: before.modules, after: after.modules, retained: before.retained };
  const record = (phase: string) =>
    atomicJson(join(root, 'journal.json'), {
      phase,
      previous: state.current,
      next: state.current,
      // True when the operator went on without a current revocation list.
      modules: staleRevocations ? { ...modules, staleRevocations } : modules,
    });
  await record('prepared');
  try {
    await writeModuleSet(root, after);
  } catch (error) {
    // A failed write may still have replaced the set (the rename succeeds, the directory sync
    // fails). Only a set written back makes `rolled-back` true; otherwise the journal stays
    // `prepared` and the next command asks for `recover`.
    try {
      await writeModuleSet(root, before);
      await record('rolled-back');
    } catch {
      // Kept `prepared` on purpose; the first error is the one to report.
    }
    throw error;
  }
  await record('committed');
  // Only now are packages the set no longer names released: those the change before retained
  // and leftovers of interrupted commands.
  await discardUnreferenced(root, after);
}

/** Whether the package changes the set; refusals keep pinned versions and forbid silent downgrades. */
function decide(
  set: ModuleSet,
  inspected: InspectedPackage,
  downgrade: boolean,
): 'unchanged' | 'install' {
  const { id, version } = inspected.manifest.module;
  const current = set.modules.find((m) => m.id === id);
  const kept = set.retained.find((p) => p.id === id && p.version === version);
  if (kept && kept.sha256 !== inspected.sha256)
    throw new Error(
      `Module ${id} ${version} is kept with different bytes; one version has one package`,
    );
  if (current === undefined) {
    // A removed module keeps its package until the next change; going below it is a downgrade.
    const removed = set.retained
      .filter((p) => p.id === id)
      .map((p) => p.version)
      .sort(compareVersions)
      .at(-1);
    if (removed !== undefined && compareVersions(version, removed) < 0 && !downgrade)
      throw new Error(
        `Module ${id} ${version} is older than the removed ${removed}; a downgrade needs --downgrade`,
      );
    return 'install';
  }
  if (current.version === version) {
    if (current.sha256 !== inspected.sha256)
      throw new Error(
        `Module ${id} ${version} is installed with different bytes; one version has one package`,
      );
    return 'unchanged';
  }
  if (current.pinned)
    throw new Error(
      `Module ${id} is pinned to ${current.version}; run arkvory module pin ${id} --unpin first`,
    );
  if (compareVersions(version, current.version) < 0 && !downgrade)
    throw new Error(
      `Module ${id} ${version} is older than ${current.version}; a downgrade needs --downgrade`,
    );
  return 'install';
}

function summary(inspected: InspectedPackage, context: ModuleCommandContext): void {
  const { module, package: fields } = inspected.manifest;
  context.print(
    `Module ${module.id} ${module.version} (${module.kind}), signed by key ${inspected.signer.keyId}`,
  );
  context.print(
    `  roles: ${module.roles.join(', ')}; data: ${fields.dataClass}; license feature: ${fields.licenseFeature ?? 'none'}`,
  );
  context.print(`  package sha256: ${inspected.sha256}`);
  if (inspected.terms === null) return;
  context.print('  Terms of the module (files/LICENSE.md):');
  // Terms are signed text, but still never reach the terminal as control sequences.
  for (const line of inspected.terms.text.replace(/[^\P{Cc}\n\t]/gu, '').split('\n'))
    context.print(`  | ${line}`);
  if (inspected.terms.truncated) context.print('  | … (the full terms are in the package)');
}

/** Keeps a newer verified list; a list never goes back (ADR 0078, 3.4). */
async function keepRevocations(
  root: string,
  state: Installation,
  stored: RevocationList | null,
  candidate: RevocationList | null,
): Promise<RevocationList | null> {
  const newer = newerRevocations(stored, candidate);
  if (newer !== null && newer !== stored) {
    acceptRevocations(stored, newer);
    await writeHostFile(root, state, revocationsPath(root), newer.envelope);
  }
  return newer;
}

/** Copies the operator's file into staging first: what is verified is what gets installed. */
async function stage(file: string, staging: string): Promise<string> {
  if (!isAbsolute(file)) throw new Error('The module package must be an absolute path');
  const info = await stat(file);
  if (!info.isFile() || info.size > PACKAGE_LIMITS.archiveBytes)
    throw new Error('The module package must be a file of at most 1 GiB');
  const staged = join(staging, `${randomUUID()}.tgz`);
  await copyFile(file, staged);
  // copyFile keeps the mode of the operator's file (0666 in /tmp, say); this copy becomes the
  // kept archive of modules/.packages, written only by the host administrator.
  await chmod(staged, 0o644);
  return staged;
}

/**
 * Puts the verified package at `modules/<id>/<version>/` (unpacked) and
 * `modules/.packages/<id>@<version>.tgz`, both written from the staged copy. Whatever was at
 * those paths is a leftover of an interrupted command or a retained copy of the same bytes
 * (`decide` refused different ones) and is replaced.
 */
async function place(root: string, staged: string, inspected: InspectedPackage): Promise<void> {
  const layout = moduleLayout(root);
  const { id, version } = inspected.manifest.module;
  const target = layout.unpacked(id, version);
  const unpacked = join(layout.staging, randomUUID());
  await extractModulePackage(staged, inspected, unpacked);
  await rm(target, { recursive: true, force: true });
  await mkdir(join(layout.directory, id), { recursive: true, mode: 0o755 });
  await rename(unpacked, target);
  await rename(staged, layout.archive(id, version));
}

export interface InstallOptions {
  readonly yes: boolean;
  readonly downgrade: boolean;
  /** Go on without a current revocation list; warned about and audited. */
  readonly allowStale: boolean;
}

/**
 * `arkvory module install <file>` (ADR 0078, 3.3 and 4): copy, verify (signature, manifest,
 * files, compatibility), refuse revoked versions, show what is installed and the module's
 * terms, and only with `--yes` unpack and change the set through the journal. A newer verified
 * revocation list shipped in the package is kept even when the installation is not confirmed.
 */
export async function installModule(
  root: string,
  file: string,
  options: InstallOptions,
  context: ModuleCommandContext,
): Promise<void> {
  await checkJournal(root);
  const state = await installation(root);
  const host = await packageHost(root, state, context);
  await prepareModuleDirectories(root);
  const layout = moduleLayout(root);
  const staged = await stage(file, layout.staging);
  try {
    const inspected = await inspectModulePackage(staged, host, 'install');
    const { id, version } = inspected.manifest.module;
    if (inspected.signer.source !== 'signed')
      throw new Error(
        'Operator plugins are installed with arkvory plugin install (ADR 0082), which this release does not have yet',
      );
    const stored = await readStoredRevocations(root, host.keys);
    const revocations = await keepRevocations(root, state, stored, inspected.revocations);
    const revoked = revocationOf(revocations, id, version);
    if (revoked !== null)
      throw new Error(
        `Module ${id} ${version} is revoked (module_revoked, ${revoked.reason})${revoked.replacement ? `; install ${revoked.replacement}` : ''}`,
      );
    const set = await readModuleSet(root);
    const decision = decide(set, inspected, options.downgrade);
    summary(inspected, context);
    if (decision === 'unchanged') {
      context.print(`Module ${id} ${version} is already installed`);
      return;
    }
    // After a list the package shipped is kept: a current one there makes the install current.
    const stale = staleRevocations(revocations, context.now());
    refuseStaleRevocations(stale, options.allowStale);
    if (!options.yes) throw new Error('Review the module and its terms, then repeat with --yes');
    if (stale !== null)
      await recordStaleRevocations(
        root,
        revocations,
        { command: 'install', module: id, version },
        context,
      );
    await place(root, staged, inspected);
    const previous = set.modules.find((m) => m.id === id);
    const entry: InstalledModule = {
      id,
      version,
      sha256: inspected.sha256,
      keyId: inspected.signer.keyId,
      source: 'signed',
      dataClass: inspected.manifest.package.dataClass,
      pinned: false,
      installedAt: new Date(context.now()).toISOString(),
    };
    await changeSet(
      root,
      state,
      set,
      {
        format: 1,
        modules: [...set.modules.filter((m) => m.id !== id), entry].sort((a, b) =>
          a.id < b.id ? -1 : 1,
        ),
        retained: previous ? [{ id, version: previous.version, sha256: previous.sha256 }] : [],
      },
      stale !== null,
    );
    context.print(
      `Installed module ${id} ${version}; it loads at the next start of the services once ARKVORY_MODULES_FILE enables it`,
    );
  } finally {
    await rm(staged, { force: true });
  }
}

/**
 * `arkvory module remove <id>`: the module leaves the set and its package is kept until the next
 * change. A module that changes how published bytes are stored (`layout`) may own data that only
 * its read path reads; it is never removed before evacuation (ADR 0078, L2 and L3).
 */
export async function removeModule(
  root: string,
  id: string,
  context: ModuleCommandContext,
): Promise<void> {
  await checkJournal(root);
  const state = await installation(root);
  const set = await readModuleSet(root);
  const entry = set.modules.find((m) => m.id === id);
  if (entry === undefined) throw new Error(`Module ${id} is not installed`);
  if (entry.dataClass === 'layout')
    throw new Error(
      `Module ${id} stores published bytes (module_owns_data); evacuate its data first (ADR 0078, L3)`,
    );
  await changeSet(root, state, set, {
    format: 1,
    modules: set.modules.filter((m) => m.id !== id),
    retained: [{ id, version: entry.version, sha256: entry.sha256 }],
  });
  context.print(
    `Removed module ${id} ${entry.version}; its package is kept until the next module change`,
  );
}

/**
 * `arkvory module pin <id> <version> | --unpin`: updates keep a pinned version (ADR 0078, 3.5).
 * Pinning keeps a version against later updates, so it needs a current revocation list like an
 * install; `--unpin` only lets updates through again and needs none.
 */
export async function pinModule(
  root: string,
  id: string,
  version: string | null,
  allowStale: boolean,
  context: ModuleCommandContext,
): Promise<void> {
  await checkJournal(root);
  const set = await readModuleSet(root);
  const entry = set.modules.find((m) => m.id === id);
  if (entry === undefined) throw new Error(`Module ${id} is not installed`);
  if (version !== null && version !== entry.version)
    throw new Error(`Module ${id} is installed at ${entry.version}; pin the installed version`);
  if (version !== null) {
    const host = await packageHost(root, await installation(root), context);
    const list = await readStoredRevocations(root, host.keys);
    const stale = staleRevocations(list, context.now());
    refuseStaleRevocations(stale, allowStale);
    if (stale !== null)
      await recordStaleRevocations(root, list, { command: 'pin', module: id, version }, context);
  }
  const modules = set.modules.map((m) => (m.id === id ? { ...m, pinned: version !== null } : m));
  await writeModuleSet(root, { ...set, modules });
  context.print(
    version === null ? `Module ${id} is no longer pinned` : `Module ${id} is pinned to ${version}`,
  );
}

/** `arkvory module revocations <file>`: a signed list from a file, for hosts without the hub. */
export async function applyRevocations(
  root: string,
  file: string,
  context: ModuleCommandContext,
): Promise<void> {
  await checkJournal(root);
  const state = await installation(root);
  const host = await packageHost(root, state, context);
  const tooBig = 'The revocation list must be an absolute path of a file of at most 1 MiB';
  if (!isAbsolute(file)) throw new Error(tooBig);
  const info = await lstat(file);
  if (!info.isFile() || info.size > PACKAGE_LIMITS.revocationsBytes) throw new Error(tooBig);
  const candidate = readRevocations(await readFile(file, 'utf8'), host.keys);
  const stored = await readStoredRevocations(root, host.keys);
  if (acceptRevocations(stored, candidate) === 'unchanged') {
    context.print(`Revocation list ${String(candidate.sequence)} is already stored`);
    return;
  }
  // The newest list is stored even when it is expired: it carries the newest revocations.
  await writeHostFile(root, state, revocationsPath(root), candidate.envelope);
  context.print(
    `Stored revocation list ${String(candidate.sequence)} (${String(candidate.entries.length)} entries)`,
  );
  if (staleRevocations(candidate, context.now()) !== null)
    context.print(
      `Warning: revocation list ${String(candidate.sequence)} expired at ${candidate.expiresAt}; installs and pins stay refused until a current list is stored`,
    );
}
