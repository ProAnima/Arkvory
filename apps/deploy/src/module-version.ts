import { parseSemanticVersion } from '@proanima/arkvory-extension-api';

const NUMERIC = /^[0-9]+$/;

/** Pre-release identifiers by semver 2.0.0, item 11: numbers by value and below any text. */
function comparePrerelease(a: string, b: string): number {
  const x = a.split('.');
  const y = b.split('.');
  for (let index = 0; index < Math.min(x.length, y.length); index++) {
    const left = x[index] ?? '';
    const right = y[index] ?? '';
    if (left === right) continue;
    const leftNumber = NUMERIC.test(left);
    const rightNumber = NUMERIC.test(right);
    // Without leading zeros (parseSemanticVersion refuses them) the longer number is larger;
    // comparing digits avoids the precision limit of Number for long identifiers.
    if (leftNumber && rightNumber)
      return left.length !== right.length ? left.length - right.length : left < right ? -1 : 1;
    if (leftNumber !== rightNumber) return leftNumber ? -1 : 1;
    return left < right ? -1 : 1;
  }
  return x.length - y.length;
}

/**
 * Precedence of two module versions (semver 2.0.0, item 11): negative when `a` is older. The
 * downgrade guard of `module install` depends on it, so `1.0.0-beta.10` is newer than
 * `1.0.0-beta.9` and every pre-release is older than its release.
 */
export function compareVersions(a: string, b: string): number {
  const x = parseSemanticVersion(a);
  const y = parseSemanticVersion(b);
  if (!x || !y) throw new Error('Invalid module version');
  for (const key of ['major', 'minor', 'patch'] as const)
    if (x[key] !== y[key]) return x[key] - y[key];
  if (x.prerelease === y.prerelease) return 0;
  if (x.prerelease === null) return 1;
  if (y.prerelease === null) return -1;
  return comparePrerelease(x.prerelease, y.prerelease);
}
