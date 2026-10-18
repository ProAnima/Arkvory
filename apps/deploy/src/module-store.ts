import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { MODULE_ID_PATTERN, parseSemanticVersion } from '@proanima/arkvory-extension-api';
import { MODULE_SET_FILE, parseModuleSet, parseRetained } from '@proanima/arkvory-signing';
import type { InstalledModule, ModuleSet, RetainedPackage } from '@proanima/arkvory-signing';
import { atomicJson, inside, jsonFile, readOptional } from './files.js';
import { record } from './model.js';
import { commandOutput } from './process.js';

export type { InstalledModule, ModuleSet, RetainedPackage };

export const emptyModuleSet: ModuleSet = { format: 1, modules: [], retained: [] };

/**
 * Where module packages live under the installation root (on the replicated volume in HA). The
 * names starting with a dot can never be module ids, so they never collide with `<id>/`.
 */
export function moduleLayout(root: string) {
  const directory = inside(root, 'modules');
  return {
    directory,
    set: join(directory, MODULE_SET_FILE),
    /** Operator decisions the module commands record, one JSON object per line. */
    audit: join(directory, 'audit.jsonl'),
    staging: join(directory, '.staging'),
    archives: join(directory, '.packages'),
    /** The unpacked package that the loader verifies and imports from. */
    unpacked: (id: string, version: string) => join(directory, id, version),
    /** The archive as signed and distributed; part of backups with the module's data (L2). */
    archive: (id: string, version: string) => join(directory, '.packages', `${id}@${version}.tgz`),
  };
}

export async function readModuleSet(root: string): Promise<ModuleSet> {
  const path = moduleLayout(root).set;
  if ((await readOptional(path)) === null) return emptyModuleSet;
  return parseModuleSet(await jsonFile(path));
}

/** One atomic replacement: a reader sees the previous set or the next one, never a mix. */
export async function writeModuleSet(root: string, set: ModuleSet): Promise<void> {
  await atomicJson(moduleLayout(root).set, set);
}

/**
 * Creates the module directories and removes what an interrupted command left in staging.
 * Runs under the installation lock, so nothing else writes staging at the same time.
 */
export async function prepareModuleDirectories(root: string): Promise<void> {
  const layout = moduleLayout(root);
  await mkdir(layout.directory, { recursive: true, mode: 0o755 });
  if (process.platform === 'win32') await grantServiceRead(layout.directory);
  await mkdir(layout.archives, { recursive: true, mode: 0o755 });
  await rm(layout.staging, { recursive: true, force: true });
  await mkdir(layout.staging, { mode: 0o700 });
}

/**
 * Windows: the services run as LocalService (S-1-5-19), which must read and list the packages
 * the loader verifies and imports, and nothing more; the administrators keep the inherited full
 * control. `/grant:r` replaces an earlier grant of the same account, so the call is repeatable.
 * Linux needs nothing: directories 0755 and files 0644 of root are readable by the service.
 */
async function grantServiceRead(directory: string): Promise<void> {
  const icacls = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'icacls.exe');
  await commandOutput(icacls, [directory, '/grant:r', '*S-1-5-19:(OI)(CI)RX']);
}

function referenced(set: ModuleSet, id: string, version: string): boolean {
  return [...set.modules, ...set.retained].some((p) => p.id === id && p.version === version);
}

const ARCHIVE = /^(.+)@(.+)\.tgz$/;

/**
 * Deletes every package that `set` does not name, after a committed change: the packages the
 * change before it retained, and whatever an interrupted command left behind (a package placed
 * before its journal record, a set write that failed, a half finished discard). Only names this
 * layout gives packages are touched: `<id>/<version>/` and `.packages/<id>@<version>.tgz` with
 * a valid id and version. A package the set names is never deleted.
 */
export async function discardUnreferenced(root: string, set: ModuleSet): Promise<void> {
  const layout = moduleLayout(root);
  const valid = (id: string, version: string) =>
    MODULE_ID_PATTERN.test(id) && parseSemanticVersion(version) !== null;
  for (const name of await readdir(layout.archives)) {
    const match = ARCHIVE.exec(name);
    const [id, version] = [match?.[1] ?? '', match?.[2] ?? ''];
    if (match && valid(id, version) && !referenced(set, id, version))
      await rm(layout.archive(id, version), { force: true });
  }
  for (const id of await readdir(layout.directory)) {
    if (!MODULE_ID_PATTERN.test(id)) continue;
    const parent = join(layout.directory, id);
    const versions = await readdir(parent).catch(() => null);
    if (versions === null) continue;
    for (const version of versions)
      if (valid(id, version) && !referenced(set, id, version))
        await rm(layout.unpacked(id, version), { recursive: true, force: true });
    if ((await readdir(parent)).length === 0) await rm(parent, { recursive: true });
  }
}

/**
 * `recover` of a module set change (ADR 0059): the previous set returns. Packages that set
 * retained (`modules.retained` of the journal) stay retained, and so do the packages of the
 * interrupted change, so the next successful change discards them; nothing a set may name is
 * deleted here.
 */
export async function recoverModuleSet(
  root: string,
  journal: Record<string, unknown>,
): Promise<void> {
  const modules = record(journal['modules']);
  const previous = parseModuleSet({ format: 1, modules: modules['before'], retained: [] }).modules;
  const set = await readModuleSet(root);
  const left = set.modules.filter(
    (m) => !previous.some((p) => p.id === m.id && p.version === m.version),
  );
  const kept: RetainedPackage[] = [];
  for (const item of [...parseRetained(modules['retained']), ...set.retained, ...left])
    if (!kept.some((p) => p.id === item.id && p.version === item.version))
      kept.push({ id: item.id, version: item.version, sha256: item.sha256 });
  await writeModuleSet(root, { format: 1, modules: previous, retained: kept });
  await atomicJson(join(root, 'journal.json'), { ...journal, phase: 'recovered' });
}
