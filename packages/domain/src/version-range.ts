import { ArkvoryError } from './artifact.js';

export interface SemVer {
  readonly core: readonly [bigint, bigint, bigint];
  readonly prerelease: readonly string[];
}
type Operator = '<' | '<=' | '>' | '>=' | '=';
interface Comparator {
  readonly operator: Operator;
  readonly version: SemVer;
}
/** Alternatives joined by `||`; every comparator inside one alternative must hold. */
export type VersionRange = readonly (readonly Comparator[])[];

const exact =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const partial =
  /^v?(\*|x|X|0|[1-9][0-9]*)(?:\.(\*|x|X|0|[1-9][0-9]*))?(?:\.(\*|x|X|0|[1-9][0-9]*))?(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function parseSemVer(value: string): SemVer | null {
  const match = exact.exec(value);
  if (!match) return null;
  return {
    core: [BigInt(match[1] ?? '0'), BigInt(match[2] ?? '0'), BigInt(match[3] ?? '0')],
    prerelease: match[4]?.split('.') ?? [],
  };
}

function compareIdentifier(left: string, right: string): number {
  const numeric = /^[0-9]+$/;
  if (numeric.test(left) && numeric.test(right)) {
    const a = BigInt(left),
      b = BigInt(right);
    return a === b ? 0 : a < b ? -1 : 1;
  }
  if (numeric.test(left)) return -1;
  if (numeric.test(right)) return 1;
  return left === right ? 0 : left < right ? -1 : 1;
}

export function compareSemVer(left: SemVer, right: SemVer): number {
  for (let i = 0; i < 3; i++) {
    const a = left.core[i] ?? 0n,
      b = right.core[i] ?? 0n;
    if (a !== b) return a < b ? -1 : 1;
  }
  if (!left.prerelease.length || !right.prerelease.length)
    return right.prerelease.length - left.prerelease.length;
  for (let i = 0; i < Math.max(left.prerelease.length, right.prerelease.length); i++) {
    const a = left.prerelease[i],
      b = right.prerelease[i];
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    const order = compareIdentifier(a, b);
    if (order) return order;
  }
  return 0;
}

const version = (
  major: bigint,
  minor: bigint,
  patch: bigint,
  prerelease: readonly string[] = [],
) => ({
  core: [major, minor, patch] as const,
  prerelease,
});
const wildcard = (value: string | undefined) => value === undefined || /^[*xX]$/.test(value);

/** Expands one token (`^1.2`, `~1`, `1.x`, `>=1.0.0-rc.1`) into comparators. */
function expand(token: string): Comparator[] {
  const [, operator = '', body = ''] = /^(\^|~|>=|<=|>|<|=)?(.*)$/.exec(token) ?? [];
  const match = partial.exec(body);
  if (!match) throw new ArkvoryError('invalid_input', 'Invalid version range');
  const [, rawMajor, rawMinor, rawPatch, pre] = match;
  if (wildcard(rawMajor)) {
    // `<*` and `>*` match nothing: no version precedes the lowest prerelease 0.0.0-0.
    if (operator === '<' || operator === '>')
      return [{ operator: '<', version: version(0n, 0n, 0n, ['0']) }];
    return [];
  }
  const major = BigInt(rawMajor ?? '0');
  const minor = wildcard(rawMinor) ? undefined : BigInt(rawMinor ?? '0');
  const patch = minor === undefined || wildcard(rawPatch) ? undefined : BigInt(rawPatch ?? '0');
  const prerelease = patch === undefined ? [] : (pre?.split('.') ?? []);
  const low = version(major, minor ?? 0n, patch ?? 0n, prerelease);
  const upper = (m: bigint, n: bigint, p: bigint): Comparator => ({
    operator: '<',
    version: version(m, n, p, ['0']),
  });
  switch (operator) {
    case '^': {
      const next =
        major > 0n || minor === undefined
          ? upper(major + 1n, 0n, 0n)
          : minor > 0n || patch === undefined
            ? upper(0n, minor + 1n, 0n)
            : upper(0n, 0n, patch + 1n);
      return [{ operator: '>=', version: low }, next];
    }
    case '~':
      return [
        { operator: '>=', version: low },
        minor === undefined ? upper(major + 1n, 0n, 0n) : upper(major, minor + 1n, 0n),
      ];
    case '':
    case '=':
      if (patch !== undefined) return [{ operator: '=', version: low }];
      return [
        { operator: '>=', version: low },
        minor === undefined ? upper(major + 1n, 0n, 0n) : upper(major, minor + 1n, 0n),
      ];
    case '>':
      if (patch !== undefined) return [{ operator: '>', version: low }];
      return [
        {
          operator: '>=',
          version:
            minor === undefined ? version(major + 1n, 0n, 0n) : version(major, minor + 1n, 0n),
        },
      ];
    case '<=':
      if (patch !== undefined) return [{ operator: '<=', version: low }];
      return [minor === undefined ? upper(major + 1n, 0n, 0n) : upper(major, minor + 1n, 0n)];
    case '<':
      return [
        {
          operator: '<',
          version: patch === undefined ? version(major, minor ?? 0n, 0n, ['0']) : low,
        },
      ];
    default:
      return [{ operator: '>=', version: low }];
  }
}

/** Supports exact, `^`, `~`, x-ranges, comparators, `a - b` hyphen ranges and `||`. */
export function parseVersionRange(text: string): VersionRange {
  if (text.length > 256 || /[^0-9A-Za-z.+\-*^~<>=|\s]/.test(text))
    throw new ArkvoryError('invalid_input', 'Invalid version range');
  const alternatives = text.split('||').map((part) => part.trim());
  if (alternatives.length > 16) throw new ArkvoryError('invalid_input', 'Invalid version range');
  return alternatives.map((alternative) => {
    const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(alternative);
    const tokens = hyphen
      ? [`>=${hyphen[1] ?? ''}`, `<=${hyphen[2] ?? ''}`]
      : alternative
          .replace(/(\^|~|>=|<=|>|<|=)\s+/g, '$1')
          .split(/\s+/)
          .filter(Boolean);
    if (tokens.length > 32) throw new ArkvoryError('invalid_input', 'Invalid version range');
    return tokens.flatMap(expand);
  });
}

function holds(value: SemVer, comparator: Comparator): boolean {
  const order = compareSemVer(value, comparator.version);
  switch (comparator.operator) {
    case '<':
      return order < 0;
    case '<=':
      return order <= 0;
    case '>':
      return order > 0;
    case '>=':
      return order >= 0;
    case '=':
      return order === 0;
  }
}

/**
 * Prereleases match only when allowed explicitly or when a comparator of the same alternative
 * names a prerelease of the same major.minor.patch (npm semantics).
 */
export function satisfies(value: SemVer, range: VersionRange, includePrerelease = false): boolean {
  return range.some((comparators) => {
    if (!comparators.every((comparator) => holds(value, comparator))) return false;
    if (!value.prerelease.length || includePrerelease) return true;
    return comparators.some(
      (comparator) =>
        comparator.version.prerelease.length > 0 &&
        comparator.version.prerelease[0] !== '0' &&
        comparator.version.core.every((part, index) => part === value.core[index]),
    );
  });
}
