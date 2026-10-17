import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { MODULE_ID_PATTERN, parseSemanticVersion } from '@proanima/arkvory-extension-api';
import { DATA_CLASSES } from '@proanima/arkvory-signing';
import type { DataClass } from '@proanima/arkvory-signing';
import { atomicJson, inside, jsonFile, readOptional } from './files.js';
import { record } from './model.js';

/** A module package installed on this host and selected for the installation. */
export interface InstalledModule {
  readonly id: string;
  readonly version: string;
  /** SHA-256 of the package archive: the package hash of the plan, journal and backups. */
  readonly sha256: string;
  readonly keyId: string;
  /** ProAnimaStudio modules only; operator plugins come with `arkvory plugin` (ADR 0082). */
  readonly source: 'signed';
  readonly dataClass: DataClass;
  /** Updates keep this version (ADR 0078, 3.5). */
  readonly pinned: boolean;
  readonly installedAt: string;
}

/** A package that left the set in the last change, kept until the next one succeeds. */
export interface RetainedPackage {
  readonly id: string;
  readonly version: string;
  readonly sha256: string;
}

/** `modules/installed.json`: the module set of the installation. */
export interface ModuleSet {
  readonly format: 1;
  readonly modules: readonly InstalledModule[];
  readonly retained: readonly RetainedPackage[];
}

export const emptyModuleSet: ModuleSet = { format: 1, modules: [], retained: [] };

/**
 * Where module packages live under the installation root (on the replicated volume in HA). The
 * names starting with a dot can never be module ids, so they never collide with `<id>/`.
 */
export function moduleLayout(root: string) {
  const directory = inside(root, 'modules');
  return {
    directory,
    set: join(directory, 'installed.json'),
    staging: join(directory, '.staging'),
    archives: join(directory, '.packages'),
    /** The unpacked package that the loader verifies and imports from. */
    unpacked: (id: string, version: string) => join(directory, id, version),
    /** The archive as signed and distributed; part of backups with the module's data (L2). */
    archive: (id: string, version: string) => join(directory, '.packages', `${id}@${version}.tgz`),
  };
}

const DIGEST = /^[0-9a-f]{64}$/;
const KEY_ID = /^[0-9a-f]{16}$/;

function text(value: unknown, valid: (text: string) => boolean, name: string): string {
  if (typeof value !== 'string' || !valid(value)) throw new Error(`Invalid module set: ${name}`);
  return value;
}

function retained(value: unknown): RetainedPackage {
  const row = record(value);
  return {
    id: text(row['id'], (v) => MODULE_ID_PATTERN.test(v), 'id'),
    version: text(row['version'], (v) => parseSemanticVersion(v) !== null, 'version'),
    sha256: text(row['sha256'], (v) => DIGEST.test(v), 'sha256'),
  };
}

function installed(value: unknown): InstalledModule {
  const row = record(value);
  const dataClass = DATA_CLASSES.find((item) => item === row['dataClass']);
  if (dataClass === undefined || row['source'] !== 'signed' || typeof row['pinned'] !== 'boolean')
    throw new Error('Invalid module set: module');
  return {
    ...retained(row),
    keyId: text(row['keyId'], (v) => KEY_ID.test(v), 'keyId'),
    source: 'signed',
    dataClass,
    pinned: row['pinned'],
    installedAt: text(row['installedAt'], (v) => Number.isFinite(Date.parse(v)), 'installedAt'),
  };
}

/** Reads the set as untrusted input; one module id appears once. */
export function parseModuleSet(value: unknown): ModuleSet {
  const row = record(value);
  if (row['format'] !== 1 || !Array.isArray(row['modules']) || !Array.isArray(row['retained']))
    throw new Error('Invalid module set');
  const modules = row['modules'].map((item: unknown) => installed(item));
  if (new Set(modules.map((m) => m.id)).size !== modules.length)
    throw new Error('Invalid module set: duplicate module');
  return { format: 1, modules, retained: row['retained'].map((item: unknown) => retained(item)) };
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
  await mkdir(layout.archives, { recursive: true, mode: 0o755 });
  await rm(layout.staging, { recursive: true, force: true });
  await mkdir(layout.staging, { mode: 0o700 });
}

function referenced(set: ModuleSet, id: string, version: string): boolean {
  return [...set.modules, ...set.retained].some((p) => p.id === id && p.version === version);
}

/**
 * Deletes the packages of `candidates` that `set` no longer names: after a committed change,
 * the packages retained by the change before it. A package that a module still names is never
 * deleted, and neither is anything this command did not put in the list.
 */
export async function discardPackages(
  root: string,
  candidates: readonly RetainedPackage[],
  set: ModuleSet,
): Promise<void> {
  const layout = moduleLayout(root);
  for (const item of candidates) {
    if (referenced(set, item.id, item.version)) continue;
    await rm(layout.unpacked(item.id, item.version), { recursive: true, force: true });
    await rm(layout.archive(item.id, item.version), { force: true });
    const parent = join(layout.directory, item.id);
    if ((await readdir(parent).catch(() => null))?.length === 0)
      await rm(parent, { recursive: true });
  }
}

/**
 * `recover` of a module set change (ADR 0059): the previous set returns. Packages of the
 * interrupted change stay retained, so the next successful change discards them; nothing a set
 * may name is deleted here.
 */
export async function recoverModuleSet(
  root: string,
  journal: Record<string, unknown>,
): Promise<void> {
  const modules = journal['modules'];
  const before =
    typeof modules === 'object' && modules !== null && 'before' in modules
      ? modules.before
      : undefined;
  const previous = parseModuleSet({ format: 1, modules: before, retained: [] }).modules;
  const set = await readModuleSet(root);
  const left = set.modules.filter(
    (m) => !previous.some((p) => p.id === m.id && p.version === m.version),
  );
  await writeModuleSet(root, {
    format: 1,
    modules: previous,
    retained: [
      ...set.retained,
      ...left.map(({ id, version, sha256 }) => ({ id, version, sha256 })),
    ],
  });
  await atomicJson(join(root, 'journal.json'), { ...journal, phase: 'recovered' });
}
