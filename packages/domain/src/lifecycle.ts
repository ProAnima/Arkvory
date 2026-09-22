import { DepotError } from './artifact.js';

export const PART_BYTES = 8 * 1024 ** 2;
export interface UploadPart {
  readonly index: number;
  readonly size: number;
  readonly sha256: string;
}

export function partSize(total: number, index: number): number {
  if (!Number.isSafeInteger(index) || index < 0 || index >= Math.ceil(total / PART_BYTES))
    throw new DepotError('invalid_input', 'Invalid part index');
  return Math.min(PART_BYTES, total - index * PART_BYTES);
}

export function checkParts(total: number, parts: readonly UploadPart[]): void {
  if (parts.length !== Math.ceil(total / PART_BYTES))
    throw new DepotError('conflict', 'Upload is missing parts');
  parts.forEach((part, index) => {
    if (part.index !== index || part.size !== partSize(total, index))
      throw new DepotError('conflict', 'Invalid part coverage');
  });
}

export function requireAssetPath(path: string): string {
  if (
    path.length < 1 ||
    path.length > 1024 ||
    path.includes('\\') ||
    path.includes(':') ||
    path
      .split('/')
      .some(
        (segment) =>
          segment === '' || segment === '.' || segment === '..' || /[\p{Cc}]/u.test(segment),
      )
  )
    throw new DepotError('invalid_input', 'Invalid asset path');
  return path;
}

export interface PackageManifest {
  readonly group: string;
  readonly name: string;
  readonly version: string;
  readonly original: Readonly<Record<string, unknown>>;
}
export function parseManifest(value: unknown): PackageManifest {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new DepotError('invalid_input', 'Invalid UPack manifest');
  const original: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  const name = original['name'];
  const version = original['version'];
  const group = original['group'] ?? '';
  if (
    typeof name !== 'string' ||
    !/^[A-Za-z0-9_.-]{1,128}$/.test(name) ||
    typeof group !== 'string' ||
    group.length > 128 ||
    (group !== '' && !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(group)) ||
    typeof version !== 'string' ||
    version.length > 128 ||
    !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.test(
      version,
    )
  )
    throw new DepotError('invalid_input', 'Invalid UPack identity or semantic version');
  const prerelease = version.split('+')[0]?.split('-').slice(1).join('-');
  requireAssetPath(name);
  if (group) requireAssetPath(group);
  if (
    prerelease
      ?.split('.')
      .some((value) => /^[0-9]+$/.test(value) && value.length > 1 && value.startsWith('0'))
  )
    throw new DepotError('invalid_input', 'Invalid numeric prerelease');
  return { name, group, version, original };
}

export function compareVersions(left: string, right: string): number {
  const split = (value: string): { main: readonly string[]; pre: readonly string[] } => {
    const core = value.split('+')[0] ?? '';
    const dash = core.indexOf('-');
    return {
      main: (dash < 0 ? core : core.slice(0, dash)).split('.'),
      pre: dash < 0 ? [] : core.slice(dash + 1).split('.'),
    };
  };
  const a = split(left);
  const b = split(right);
  for (let i = 0; i < 3; i++) {
    const x = BigInt(a.main[i] ?? '0');
    const y = BigInt(b.main[i] ?? '0');
    if (x !== y) return x < y ? -1 : 1;
  }
  if (a.pre.length === 0 || b.pre.length === 0)
    return a.pre.length === b.pre.length ? 0 : a.pre.length === 0 ? 1 : -1;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i];
    const y = b.pre[i];
    if (x === y) continue;
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = /^[0-9]+$/.test(x);
    const yn = /^[0-9]+$/.test(y);
    if (xn && yn) return BigInt(x) < BigInt(y) ? -1 : 1;
    if (xn !== yn) return xn ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}
