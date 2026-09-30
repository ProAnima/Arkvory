export interface StorageRoutingRule {
  readonly id: string;
  readonly backendId: string;
  readonly repository?: string;
  readonly packageGroup?: string;
  readonly minSizeBytes?: number;
}

export function matchRoutingRule(
  rule: StorageRoutingRule,
  context: { repository: string; packageGroup?: string | undefined; size?: number | undefined },
): boolean {
  if (rule.repository && rule.repository !== '*' && rule.repository !== context.repository)
    return false;
  if (rule.packageGroup && rule.packageGroup !== '*') {
    if (!context.packageGroup) return false;
    if (rule.packageGroup.endsWith('/*')) {
      const prefix = rule.packageGroup.slice(0, -2).toLowerCase();
      const actual = context.packageGroup.toLowerCase();
      if (actual !== prefix && !actual.startsWith(prefix + '/')) return false;
    } else {
      if (rule.packageGroup.toLowerCase() !== context.packageGroup.toLowerCase()) return false;
    }
  }
  if (rule.minSizeBytes !== undefined) {
    if (context.size === undefined || context.size < rule.minSizeBytes) return false;
  }
  return true;
}

export function resolveStorageBackend(
  rules: readonly StorageRoutingRule[],
  context: { repository: string; packageGroup?: string | undefined; size?: number | undefined },
  defaultBackend = 'default',
): string {
  for (const rule of rules) {
    if (matchRoutingRule(rule, context)) return rule.backendId;
  }
  return defaultBackend;
}
