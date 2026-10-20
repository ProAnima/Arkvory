/**
 * Version of this contract (semver, independent of the core release). Below 1.0.0 every minor
 * version may change the contract incompatibly; `api-report.d.ts` records what each version
 * exports, and a policy test keeps the record, this constant and the manifest version equal.
 */
export const EXTENSION_API_VERSION = '0.10.0';

export interface SemanticVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  /** Dot-separated pre-release identifiers, or null for a release. */
  readonly prerelease: string | null;
}

const VERSION_PATTERN =
  /^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
/** A numeric pre-release identifier with a leading zero, which semver 2.0.0 (item 9) forbids. */
const LEADING_ZERO = /^0[0-9]+$/;
const MAX_VERSION_LENGTH = 64;

/** A semver version without build metadata, or null when the text is not one. */
export function parseSemanticVersion(text: string): SemanticVersion | null {
  if (text.length > MAX_VERSION_LENGTH) return null;
  const match = VERSION_PATTERN.exec(text);
  if (!match) return null;
  const prerelease = match[4] ?? null;
  if (prerelease?.split('.').some((identifier) => LEADING_ZERO.test(identifier))) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease,
  };
}

/** The release `^X.Y.Z` names, or null when the text is not such a caret range. */
export function parseCaretRange(text: string): SemanticVersion | null {
  if (!text.startsWith('^')) return null;
  const version = parseSemanticVersion(text.slice(1));
  return version && version.prerelease === null ? version : null;
}

function atLeast(version: SemanticVersion, minor: number, patch: number) {
  return version.minor > minor || (version.minor === minor && version.patch >= patch);
}

/**
 * Whether `version` satisfies the caret range `^range` as npm reads it: the same major from 1.0.0
 * on, the same minor below it, and only the exact patch for 0.0.z. Pre-releases never satisfy.
 */
export function satisfiesCaret(range: SemanticVersion, version: SemanticVersion): boolean {
  if (version.prerelease !== null || version.major !== range.major) return false;
  if (range.major > 0) return atLeast(version, range.minor, range.patch);
  if (range.minor > 0) return version.minor === range.minor && version.patch >= range.patch;
  return version.minor === 0 && version.patch === range.patch;
}
