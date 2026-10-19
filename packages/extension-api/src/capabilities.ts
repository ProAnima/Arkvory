import { parseCaretRange, parseSemanticVersion, type SemanticVersion } from './version.js';

/**
 * The typed value of a capability one module gives others (ADR 0083, N13). The provider's
 * package publishes the token: the type and the shape check of its value; this contract only
 * defines the form.
 */
export interface CapabilityToken<T> {
  /** As in `provides` and `requires`, without the version. */
  readonly name: string;
  /** Semver of the value's contract that the consumer was written against. */
  readonly version: string;
  /** Checks the shape of a value at the boundary; the core refuses one that fails. */
  check(value: unknown): value is T;
}

/** Builds a token; throws a `TypeError` for a malformed name or version. */
export function defineCapability<T>(
  name: string,
  version: string,
  check: (value: unknown) => value is T,
): CapabilityToken<T> {
  if (!CAPABILITY_NAME.test(name)) throw new TypeError('Invalid capability name');
  const parsed = parseSemanticVersion(version);
  if (parsed === null || parsed.prerelease !== null)
    throw new TypeError('Invalid capability version');
  return Object.freeze({ name, version, check });
}

/**
 * The capabilities a module requires or may use, as its context gives them. `get` asks the
 * provider after the provider started, in plan order, and checks the value with the token:
 * a token of an incompatible contract version or a value of the wrong shape is refused
 * (`capability_invalid`). An optional capability without a provider gives null; a required one
 * whose provider is not running here is `capability_unavailable`. A value is valid until the
 * provider stops; consumers stop first.
 */
export interface ModuleCapabilities {
  get<T>(token: CapabilityToken<T>): T | null;
}

/** `[a-z][a-z0-9-]{0,63}`: the name part of a capability entry. */
export const CAPABILITY_NAME = /^[a-z][a-z0-9-]{0,63}$/;

/**
 * An entry of `provides` (`name@1.4.0`) or of `requires` and `optional` (`name@^1.2.0`). Without
 * a version an entry means `@0.0.0` (`@^0.0.0`), which the plan allows built-in modules only.
 */
export interface CapabilityEntry {
  readonly name: string;
  /** The provided version, or the release of the caret range; null when the entry has none. */
  readonly version: SemanticVersion | null;
}

function entry(text: string, parse: (version: string) => SemanticVersion | null) {
  const at = text.indexOf('@');
  const name = at < 0 ? text : text.slice(0, at);
  if (!CAPABILITY_NAME.test(name)) return null;
  if (at < 0) return { name, version: null };
  const version = parse(text.slice(at + 1));
  return version === null || version.prerelease !== null ? null : { name, version };
}

/** A `provides` entry, or null when malformed. */
export function parseProvidedCapability(text: string): CapabilityEntry | null {
  return entry(text, parseSemanticVersion);
}

/** A `requires` or `optional` entry, or null when malformed. */
export function parseRequiredCapability(text: string): CapabilityEntry | null {
  return entry(text, parseCaretRange);
}

/** The name of any capability entry: the text before `@`. */
export function capabilityName(text: string): string {
  const at = text.indexOf('@');
  return at < 0 ? text : text.slice(0, at);
}
