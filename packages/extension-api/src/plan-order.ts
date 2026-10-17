import type { ReadModule, RuleProblem } from './plan-rules.js';

/** Capability → providing module among enabled modules; a second provider is a problem. */
function providers(enabled: readonly ReadModule[], problems: RuleProblem[]) {
  const result = new Map<string, ReadModule>();
  for (const m of enabled)
    for (const capability of m.manifest.provides) {
      if (result.has(capability))
        problems.push({ code: 'duplicate_provider', module: m.manifest.id, subject: capability });
      else result.set(capability, m);
    }
  return result;
}

/**
 * Edges provider → consumer for every requirement of an enabled module. The provider must run in
 * every process the consumer runs in, or the consumer would start without it somewhere.
 */
function dependents(enabled: readonly ReadModule[], problems: RuleProblem[]) {
  const byCapability = providers(enabled, problems);
  const edges = new Map<string, Set<string>>(enabled.map((m) => [m.manifest.id, new Set()]));
  for (const m of enabled)
    for (const capability of m.manifest.requires) {
      const provider = byCapability.get(capability);
      const id = m.manifest.id;
      if (provider === undefined)
        problems.push({ code: 'missing_requirement', module: id, subject: capability });
      else if (provider !== m) {
        if (m.manifest.roles.some((role) => !provider.manifest.roles.includes(role)))
          problems.push({ code: 'requirement_role_mismatch', module: id, subject: capability });
        edges.get(provider.manifest.id)?.add(id);
      }
    }
  return edges;
}

/**
 * Start order of the enabled modules: every provider before its consumers, and among modules
 * that are free to start the smallest id first, so the order is the same on every process.
 * Modules left on a requirement cycle are reported and not ordered.
 */
export function startOrder(modules: readonly ReadModule[], problems: RuleProblem[]): string[] {
  const enabled = modules.filter((m) => m.enabled);
  const edges = dependents(enabled, problems);
  const waiting = new Map<string, number>(enabled.map((m) => [m.manifest.id, 0]));
  for (const consumers of edges.values())
    for (const consumer of consumers) waiting.set(consumer, (waiting.get(consumer) ?? 0) + 1);
  const order: string[] = [];
  for (;;) {
    const ready = [...waiting].filter(([, count]) => count === 0).map(([id]) => id);
    const next = ready.sort()[0];
    if (next === undefined) break;
    waiting.delete(next);
    order.push(next);
    for (const consumer of edges.get(next) ?? [])
      waiting.set(consumer, (waiting.get(consumer) ?? 1) - 1);
  }
  for (const id of [...waiting.keys()].sort())
    problems.push({ code: 'requirement_cycle', module: id, subject: null });
  return order;
}
