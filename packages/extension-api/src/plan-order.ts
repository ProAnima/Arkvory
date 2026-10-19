import { checkUse, optional, provided, required } from './plan-capabilities.js';
import type { ReadModule, RuleProblem } from './plan-rules.js';

/** Capability name → providing module among enabled modules; a second provider is a problem. */
function providers(enabled: readonly ReadModule[], problems: RuleProblem[]) {
  const result = new Map<string, ReadModule>();
  for (const m of enabled)
    for (const { name } of provided(m)) {
      if (result.has(name))
        problems.push({ code: 'duplicate_provider', module: m.manifest.id, subject: name });
      else result.set(name, m);
    }
  return result;
}

/**
 * Edges provider → consumer for every requirement of an enabled module and every optional
 * capability that has a provider. A required provider must run in every process the consumer
 * runs in, or the consumer would start without it somewhere; an optional one may not, the
 * consumer then gets null there. Versions and exposure are checked for both (ADR 0083, N13).
 */
function dependents(enabled: readonly ReadModule[], problems: RuleProblem[]) {
  const byName = providers(enabled, problems);
  const edges = new Map<string, Set<string>>(enabled.map((m) => [m.manifest.id, new Set()]));
  for (const m of enabled) {
    const id = m.manifest.id;
    const wanted = [
      ...required(m).map((entry) => ({ entry, needed: true })),
      ...optional(m).map((entry) => ({ entry, needed: false })),
    ];
    for (const { entry, needed } of wanted) {
      const provider = byName.get(entry.name);
      if (provider === undefined) {
        if (needed) problems.push({ code: 'missing_requirement', module: id, subject: entry.name });
        continue;
      }
      if (provider === m) continue;
      checkUse(m, provider, entry, problems);
      if (needed && m.manifest.roles.some((role) => !provider.manifest.roles.includes(role)))
        problems.push({ code: 'requirement_role_mismatch', module: id, subject: entry.name });
      edges.get(provider.manifest.id)?.add(id);
    }
  }
  return edges;
}

/** Whether `id` can reach itself along provider → consumer edges. */
function onCycle(id: string, edges: ReadonlyMap<string, ReadonlySet<string>>): boolean {
  const seen = new Set<string>();
  const next = [...(edges.get(id) ?? [])];
  for (let found = next.pop(); found !== undefined; found = next.pop()) {
    if (found === id) return true;
    if (seen.has(found)) continue;
    seen.add(found);
    next.push(...(edges.get(found) ?? []));
  }
  return false;
}

/**
 * Start order of the enabled modules: every provider before its consumers, and among modules
 * that are free to start the smallest id first, so the order is the same on every process.
 * Modules on a requirement cycle are reported; neither they nor the modules waiting behind them
 * are ordered, and only the modules on the cycle are named.
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
    if (onCycle(id, edges)) problems.push({ code: 'requirement_cycle', module: id, subject: null });
  return order;
}
