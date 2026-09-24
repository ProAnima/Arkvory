import { DepotError } from '@proanima/depot-domain';

export interface AssetEntry {
  path: string;
  revision: number;
  artifactId: string;
}

export interface AssetPage {
  items: readonly AssetEntry[];
  next: string | null;
}
export interface AssetPageOptions {
  prefix: string;
  after?: string;
  limit: number;
}
export function validateAssetPage(options: AssetPageOptions): void {
  if (options.prefix.length > 1024 || /[\p{Cc}\uD800-\uDFFF]/u.test(options.prefix))
    throw new DepotError('invalid_input', 'Invalid asset prefix');
  if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 100)
    throw new DepotError('invalid_input', 'Asset page limit must be between 1 and 100');
  if (options.after !== undefined && !/^[A-Za-z0-9_-]{1,8192}$/.test(options.after))
    throw new DepotError('invalid_input', 'Invalid asset cursor');
}
// Exclusive upper bound in Unicode scalar / UTF-8 byte order (PostgreSQL COLLATE C).
// A maximal suffix is truncated; an all-maximal prefix has no finite upper bound.
export function assetPrefixEnd(prefix: string): string | null {
  const chars = Array.from(prefix);
  for (let i = chars.length - 1; i >= 0; i--) {
    const point = chars[i]?.codePointAt(0);
    if (point !== undefined && point < 0x10ffff) {
      return (
        chars.slice(0, i).join('') + String.fromCodePoint(point === 0xd7ff ? 0xe000 : point + 1)
      );
    }
  }
  return null;
}
