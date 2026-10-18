import { MODULE_ID_PATTERN, parseSemanticVersion } from '@proanima/arkvory-extension-api';
import { DATA_CLASSES } from './package-manifest.js';
import type { DataClass } from './package-manifest.js';

/** A module package installed on the host and selected for the installation. */
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

/**
 * `modules/installed.json`: the module set of the installation. The host tool writes it, the
 * loader of the services reads it (ADR 0078, section 4; ADR 0079, X4); both read it here.
 */
export interface ModuleSet {
  readonly format: 1;
  readonly modules: readonly InstalledModule[];
  readonly retained: readonly RetainedPackage[];
}

/** The file name of the set inside `modules/`. */
export const MODULE_SET_FILE = 'installed.json';

const DIGEST = /^[0-9a-f]{64}$/;
const KEY_ID = /^[0-9a-f]{16}$/;

type Row = Readonly<Record<string, unknown>>;

function row(value: unknown): Row {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Invalid module set');
  return Object.fromEntries(Object.entries(value));
}

function text(value: unknown, valid: (text: string) => boolean, name: string): string {
  if (typeof value !== 'string' || !valid(value)) throw new Error(`Invalid module set: ${name}`);
  return value;
}

function retained(value: unknown): RetainedPackage {
  const entry = row(value);
  return {
    id: text(entry['id'], (v) => MODULE_ID_PATTERN.test(v), 'id'),
    version: text(entry['version'], (v) => parseSemanticVersion(v) !== null, 'version'),
    sha256: text(entry['sha256'], (v) => DIGEST.test(v), 'sha256'),
  };
}

function installed(value: unknown): InstalledModule {
  const entry = row(value);
  const dataClass = DATA_CLASSES.find((item) => item === entry['dataClass']);
  const pinned = entry['pinned'];
  if (dataClass === undefined || entry['source'] !== 'signed' || typeof pinned !== 'boolean')
    throw new Error('Invalid module set: module');
  return {
    ...retained(entry),
    keyId: text(entry['keyId'], (v) => KEY_ID.test(v), 'keyId'),
    source: 'signed',
    dataClass,
    pinned,
    installedAt: text(entry['installedAt'], (v) => Number.isFinite(Date.parse(v)), 'installedAt'),
  };
}

/** Reads the set as untrusted input; one module id appears once. */
export function parseModuleSet(value: unknown): ModuleSet {
  const set = row(value);
  const modules = set['modules'];
  const kept = set['retained'];
  if (set['format'] !== 1 || !Array.isArray(modules) || !Array.isArray(kept))
    throw new Error('Invalid module set');
  const list = modules.map((item: unknown) => installed(item));
  if (new Set(list.map((m) => m.id)).size !== list.length)
    throw new Error('Invalid module set: duplicate module');
  return { format: 1, modules: list, retained: kept.map((item: unknown) => retained(item)) };
}

/** Packages kept by a journal record (`modules.retained`); anything else reads as none. */
export function parseRetained(value: unknown): readonly RetainedPackage[] {
  return Array.isArray(value) ? value.map((item: unknown) => retained(item)) : [];
}
