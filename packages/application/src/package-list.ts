import { compareVersions, DepotError } from '@proanima/depot-domain';
import type { PackageEntry, PackageListOptions } from './catalog.js';

export function parsePackageListOptions(value: Record<string, unknown>): PackageListOptions {
  if (
    Object.keys(value).some(
      (key) => !['group', 'name', 'sort', 'direction', 'groupBy', 'after', 'limit'].includes(key),
    )
  )
    throw new DepotError('invalid_input', 'Unknown package list option');
  const sort = value['sort'] ?? 'group';
  const direction = value['direction'] ?? 'asc';
  const groupBy = value['groupBy'] ?? 'none';
  if (
    (sort !== 'group' && sort !== 'name' && sort !== 'version') ||
    (direction !== 'asc' && direction !== 'desc') ||
    (groupBy !== 'none' && groupBy !== 'group' && groupBy !== 'package')
  )
    throw new DepotError('invalid_input', 'Invalid package list option');
  return { sort, direction, groupBy };
}

export function organizePackages(entries: readonly PackageEntry[], options: PackageListOptions) {
  const byText = (a: string, b: string) => {
    const left = a.toLowerCase();
    const right = b.toLowerCase();
    return left < right ? -1 : left > right ? 1 : 0;
  };
  const byRaw = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const compare = (a: PackageEntry, b: PackageEntry) => {
    const group = byText(a.group, b.group);
    const name = byText(a.name, b.name);
    const version = compareVersions(a.version, b.version);
    const direction = options.direction === 'asc' ? 1 : -1;
    const result =
      options.sort === 'group'
        ? direction * (group || name) || -version
        : options.sort === 'name'
          ? direction * (name || group) || -version
          : direction * version || group || name;
    return result || byRaw(a.version, b.version) || byText(a.artifactId, b.artifactId);
  };
  const items = [...entries].sort(compare);
  if (options.groupBy === 'none') return { items, groups: [] };
  const groups = new Map<string, { group: string; name: string | null; artifactIds: string[] }>();
  for (const item of items) {
    const key =
      options.groupBy === 'group'
        ? item.group.toLowerCase()
        : `${item.group.toLowerCase()}\0${item.name.toLowerCase()}`;
    let bucket = groups.get(key);
    if (!bucket) {
      bucket = {
        group: item.group,
        name: options.groupBy === 'package' ? item.name : null,
        artifactIds: [],
      };
      groups.set(key, bucket);
    }
    bucket.artifactIds.push(item.artifactId);
  }
  return { items, groups: [...groups.values()] };
}
