import {
  ModuleServiceError,
  parseCaretRange,
  parseProvidedCapability,
  parseRequiredCapability,
  satisfiesCaret,
} from '@proanima/arkvory-extension-api';
import type {
  CapabilityEntry,
  CapabilityToken,
  ModuleCapabilities,
  ModuleLifecycle,
  ModulePlan,
  ModuleRole,
  PlannedModule,
  SemanticVersion,
} from '@proanima/arkvory-extension-api';

const ZERO: SemanticVersion = { major: 0, minor: 0, patch: 0, prerelease: null };

interface Offer {
  readonly provider: string;
  readonly version: SemanticVersion;
  /** The provider's answer, or the reason it gave none. */
  readonly value: { readonly ok: true; readonly value: unknown } | { readonly ok: false };
}

function parsed(list: readonly string[], parse: (text: string) => CapabilityEntry | null) {
  return list.flatMap((text) => {
    const entry = parse(text);
    return entry ? [entry] : [];
  });
}

/**
 * Values of capabilities between the modules of one process (ADR 0083, N13). A provider's value
 * is asked once, right after its successful start, and withdrawn when it stops; consumers start
 * after their providers and stop before them (plan order), so a consumer never holds a value of
 * a stopped provider through the core. The plan already matched versions, exposure and roles;
 * here the consumer's token is checked against the provider's version and the value's shape.
 */
export class CapabilityRegistry {
  private readonly offers = new Map<string, Offer>();

  constructor(
    private readonly plan: ModulePlan,
    /** The process: an optional capability whose provider does not run in it gives null. */
    private readonly role: ModuleRole,
  ) {}

  /** Records the values of a started provider; a throwing or missing `capability` gives none. */
  offer(module: PlannedModule, instance: ModuleLifecycle): void {
    for (const entry of parsed(module.manifest.provides, parseProvidedCapability)) {
      let value: Offer['value'] = { ok: false };
      try {
        if (instance.capability) value = { ok: true, value: instance.capability(entry.name) };
      } catch {
        value = { ok: false };
      }
      const version = entry.version ?? ZERO;
      this.offers.set(entry.name, { provider: module.manifest.id, version, value });
    }
  }

  /** Withdraws the values of a provider that stops or failed. */
  withdraw(moduleId: string): void {
    for (const [name, offer] of this.offers)
      if (offer.provider === moduleId) this.offers.delete(name);
  }

  /** The capabilities a consumer declared, as its context gives them. */
  forConsumer(module: PlannedModule): ModuleCapabilities {
    const required = parsed(module.manifest.requires, parseRequiredCapability);
    const optional = parsed(module.manifest.optional, parseRequiredCapability);
    return {
      get: <T>(token: CapabilityToken<T>): T | null => {
        const needed = required.some((entry) => entry.name === token.name);
        if (!needed && !optional.some((entry) => entry.name === token.name))
          throw new TypeError('Capability not declared in requires or optional');
        const offer = this.offers.get(token.name);
        if (!offer) {
          if (!needed && !this.providedHere(token.name)) return null;
          throw new ModuleServiceError('capability_unavailable');
        }
        if (!offer.value.ok) throw new ModuleServiceError('capability_unavailable');
        const range = parseCaretRange(`^${token.version}`);
        if (range === null || !satisfiesCaret(range, offer.version))
          throw new ModuleServiceError('capability_invalid', 'Incompatible capability version');
        const value = offer.value.value;
        if (!token.check(value))
          throw new ModuleServiceError('capability_invalid', 'Capability value has another shape');
        return value;
      },
    };
  }

  /** Whether an enabled module of this process provides the capability. */
  private providedHere(name: string): boolean {
    return this.plan.modules.some(
      (m) =>
        m.enabled &&
        m.manifest.roles.includes(this.role) &&
        parsed(m.manifest.provides, parseProvidedCapability).some((entry) => entry.name === name),
    );
  }
}
