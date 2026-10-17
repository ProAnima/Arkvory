import type { ModuleManifest } from './manifest.js';
import { parseCaretRange, parseSemanticVersion, satisfiesCaret } from './version.js';

/** A module after its manifest was read; the input of the rules below. */
export interface ReadModule {
  readonly manifest: ModuleManifest;
  readonly source: 'builtin' | 'signed';
  readonly packageSha256: string | null;
  readonly enabled: boolean;
}

export type RuleCode =
  | 'invalid_package'
  | 'core_not_builtin'
  | 'core_disabled'
  | 'incompatible_api'
  | 'route_prefix_not_owned'
  | 'metric_prefix_not_owned'
  | 'table_prefix_not_owned'
  | 'route_prefix_overlap'
  | 'metric_prefix_overlap'
  | 'table_prefix_overlap'
  | 'duplicate_provider'
  | 'missing_requirement'
  | 'requirement_role_mismatch'
  | 'requirement_cycle';

export interface RuleProblem {
  readonly code: RuleCode;
  readonly module: string;
  readonly subject: string | null;
}

const SHA256 = /^[0-9a-f]{64}$/;
/** Route namespace of signed modules (ADR 0079, 5.2); built-in modules stay outside it. */
const EXTERNAL_ROUTES = '/api/ext/';
/** Table and metric namespace of signed modules (ADR 0079, 5.6); built-in modules stay outside. */
const EXTERNAL_NAMES = 'arkvory_x_';

/** Package, core flag and extension API version of each module. */
export function checkModules(modules: readonly ReadModule[], hostApi: string): RuleProblem[] {
  const host = parseSemanticVersion(hostApi);
  if (host === null) throw new TypeError('Invalid host extension API version');
  const problems: RuleProblem[] = [];
  for (const m of modules) {
    const id = m.manifest.id;
    const sha = m.packageSha256;
    if (m.source === 'builtin' ? sha !== null : sha === null || !SHA256.test(sha))
      problems.push({ code: 'invalid_package', module: id, subject: null });
    if (m.manifest.core && m.source !== 'builtin')
      problems.push({ code: 'core_not_builtin', module: id, subject: null });
    if (m.manifest.core && !m.enabled)
      problems.push({ code: 'core_disabled', module: id, subject: null });
    const range = parseCaretRange(m.manifest.extensionApi);
    if (range === null || !satisfiesCaret(range, host))
      problems.push({ code: 'incompatible_api', module: id, subject: m.manifest.extensionApi });
  }
  return problems;
}

/**
 * Names a module may use. A signed module serves routes only under `/api/ext/<id>/v<major>/` and
 * names tables and metrics only `arkvory_x_<id>_`; built-in modules never use those namespaces.
 */
export function checkOwnership(modules: readonly ReadModule[]): RuleProblem[] {
  const problems: RuleProblem[] = [];
  for (const m of modules) {
    const { id, version, routePrefixes, metricPrefix, tablePrefix } = m.manifest;
    const signed = m.source === 'signed';
    const major = parseSemanticVersion(version)?.major ?? 0;
    const routes = `${EXTERNAL_ROUTES}${id}/v${String(major)}/`;
    const names = `${EXTERNAL_NAMES}${id.replaceAll('-', '_')}_`;
    for (const prefix of routePrefixes)
      if (signed ? !prefix.startsWith(routes) : prefix.startsWith(EXTERNAL_ROUTES))
        problems.push({ code: 'route_prefix_not_owned', module: id, subject: prefix });
    for (const [code, prefix] of [
      ['metric_prefix_not_owned', metricPrefix],
      ['table_prefix_not_owned', tablePrefix],
    ] as const)
      if (prefix !== null && (signed ? prefix !== names : prefix.startsWith(EXTERNAL_NAMES)))
        problems.push({ code, module: id, subject: prefix });
  }
  return problems;
}

const overlap = (a: string, b: string) => a.startsWith(b) || b.startsWith(a);

/** Each claim against every earlier one; the later module in id order is reported. */
function overlaps(
  code: RuleCode,
  claims: readonly { readonly module: string | null; readonly prefix: string }[],
): RuleProblem[] {
  const problems: RuleProblem[] = [];
  claims.forEach((claim, index) => {
    const module = claim.module;
    if (module === null) return;
    for (const earlier of claims.slice(0, index))
      if (earlier.module !== module && overlap(claim.prefix, earlier.prefix))
        problems.push({ code, module, subject: earlier.prefix });
  });
  return problems;
}

/**
 * Prefixes must not overlap. Routes and metrics count for enabled modules and the core's own
 * routes; tables count for every module, as built-in migrations run whether it is enabled or not.
 */
export function checkOverlaps(
  modules: readonly ReadModule[],
  reservedRoutes: readonly string[],
): RuleProblem[] {
  const enabled = modules.filter((m) => m.enabled);
  return [
    ...overlaps('route_prefix_overlap', [
      ...reservedRoutes.map((prefix) => ({ module: null, prefix })),
      ...enabled.flatMap((m) =>
        m.manifest.routePrefixes.map((prefix) => ({ module: m.manifest.id, prefix })),
      ),
    ]),
    ...overlaps(
      'metric_prefix_overlap',
      claimsOf(enabled, (m) => m.metricPrefix),
    ),
    ...overlaps(
      'table_prefix_overlap',
      claimsOf(modules, (m) => m.tablePrefix),
    ),
  ];
}

function claimsOf(
  modules: readonly ReadModule[],
  prefix: (manifest: ModuleManifest) => string | null,
): { module: string; prefix: string }[] {
  return modules.flatMap((m) => {
    const value = prefix(m.manifest);
    return value === null ? [] : [{ module: m.manifest.id, prefix: value }];
  });
}
