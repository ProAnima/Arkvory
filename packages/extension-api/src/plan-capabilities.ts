import {
  parseProvidedCapability,
  parseRequiredCapability,
  type CapabilityEntry,
} from './capabilities.js';
import type { ReadModule, RuleProblem } from './plan-rules.js';
import type { ModuleSource } from './sources.js';
import { satisfiesCaret, type SemanticVersion } from './version.js';

/** A version-less entry means `@0.0.0` (ADR 0083, N13). */
const ZERO: SemanticVersion = { major: 0, minor: 0, patch: 0, prerelease: null };

/** The parsed entries of a list a manifest already passed; a null would be a contract break. */
export function entries(
  list: readonly string[],
  parse: (text: string) => CapabilityEntry | null,
): CapabilityEntry[] {
  return list.map((text) => {
    const parsed = parse(text);
    if (parsed === null) throw new TypeError('Invalid capability entry');
    return parsed;
  });
}

export const provided = (m: ReadModule) => entries(m.manifest.provides, parseProvidedCapability);
export const required = (m: ReadModule) => entries(m.manifest.requires, parseRequiredCapability);
export const optional = (m: ReadModule) => entries(m.manifest.optional, parseRequiredCapability);

/**
 * Only the release names capabilities without versions: a module from outside it states the
 * contract version of every value it gives or takes, so that the plan can match them.
 */
export function checkVersioned(modules: readonly ReadModule[]): RuleProblem[] {
  const problems: RuleProblem[] = [];
  for (const m of modules.filter(
    (candidate) => candidate.enabled && candidate.source !== 'builtin',
  ))
    for (const entry of [...provided(m), ...required(m), ...optional(m)])
      if (entry.version === null)
        problems.push({
          code: 'capability_unversioned',
          module: m.manifest.id,
          subject: entry.name,
        });
  return problems;
}

/**
 * Sources whose `publisher` is proven: the release itself and packages signed by the module key
 * of ProAnimaStudio. An operator's or a development plugin names its publisher itself, so two of
 * them with the same name are not the same publisher.
 */
const PROVEN_PUBLISHER: readonly ModuleSource[] = ['builtin', 'signed'];

/**
 * Whether the consumer may use the provider's value: the provider's version is in the caret
 * range the consumer declared, and the value is open to it, by the same proven publisher or by
 * the provider's `exposeTo` naming the consumer's source.
 */
export function checkUse(
  consumer: ReadModule,
  provider: ReadModule,
  wanted: CapabilityEntry,
  problems: RuleProblem[],
): void {
  const offered = provided(provider).find((entry) => entry.name === wanted.name);
  const range = wanted.version ?? ZERO;
  const id = consumer.manifest.id;
  if (!satisfiesCaret(range, offered?.version ?? ZERO))
    problems.push({ code: 'requirement_version_mismatch', module: id, subject: wanted.name });
  const samePublisher =
    PROVEN_PUBLISHER.includes(consumer.source) &&
    PROVEN_PUBLISHER.includes(provider.source) &&
    consumer.manifest.publisher === provider.manifest.publisher;
  const open =
    consumer === provider || samePublisher || provider.manifest.exposeTo.includes(consumer.source);
  if (!open) problems.push({ code: 'capability_not_exposed', module: id, subject: wanted.name });
}

/**
 * What a capability list keeps in the compatibility fingerprint: names with version lines, in
 * name order, so a module that only reorders its lists keeps the processes of an installation
 * compatible.
 */
export function capabilityLines(
  m: ReadModule,
  line: (version: SemanticVersion) => string,
): Record<string, string[]> | null {
  const sorted = (list: readonly string[]) => [...list].sort();
  const lists = {
    provides: sorted(provided(m).map((e) => `${e.name}@${line(e.version ?? ZERO)}`)),
    requires: sorted(required(m).map((e) => `${e.name}@^${line(e.version ?? ZERO)}`)),
    optional: sorted(optional(m).map((e) => `${e.name}@^${line(e.version ?? ZERO)}`)),
  };
  const empty = Object.values(lists).every((list) => list.length === 0);
  return empty && m.manifest.exposeTo.length === 0
    ? null
    : { ...lists, exposeTo: sorted(m.manifest.exposeTo) };
}
