import type { ModuleSource } from './context.js';
import { MODULE_KINDS, type ModuleManifest } from './manifest.js';
import {
  parseCaretRange,
  parseSemanticVersion,
  satisfiesCaret,
  type SemanticVersion,
} from './version.js';

/** A module after its manifest was read; the input of the rules below. */
export interface ReadModule {
  readonly manifest: ModuleManifest;
  readonly source: ModuleSource;
  readonly packageSha256: string | null;
  readonly enabled: boolean;
}

/** Codes of the rules a plan applies to readable manifests; part of `ModulePlanProblemCode`. */
export type ModulePlanRuleCode =
  | 'invalid_package'
  | 'unknown_kind'
  | 'id_namespace_mismatch'
  | 'table_prefix_too_long'
  | 'service_unavailable'
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
  readonly code: ModulePlanRuleCode;
  readonly module: string;
  readonly subject: string | null;
}

const SHA256 = /^[0-9a-f]{64}$/;
/** Route namespace of signed modules (ADR 0079, 5.2); built-in modules stay outside it. */
const EXTERNAL_ROUTES = '/api/ext/';
/** Table and metric namespace of signed modules (ADR 0079, 5.6); built-in modules stay outside. */
const EXTERNAL_NAMES = 'arkvory_x_';

/**
 * Ids of operator and development plugins (ADR 0082, section 4): `op-` and at most 21 more
 * characters. ProAnimaStudio never publishes an `op-` id, so a plugin never meets a later module.
 */
const PLUGIN_ID = /^op-[a-z][a-z0-9-]{1,20}$/;
const PLUGIN_SOURCES: readonly ModuleSource[] = ['operator', 'development'];
/**
 * PostgreSQL cuts identifiers longer than 63 bytes without an error, and a cut name could equal
 * another module's. A table prefix of at most 36 characters leaves 27 for the table name and the
 * suffixes of its indexes and constraints; an external prefix `arkvory_x_<id>__` fits only with
 * an id of at most 24 characters (ADR 0083, section 2.5).
 */
const MAX_TABLE_PREFIX = 36;
const MAX_TABLE_OWNER_ID = 24;

/** Whether the id is in the namespace of the module's source. */
function idFitsSource(m: ReadModule): boolean {
  const plugin = PLUGIN_SOURCES.includes(m.source);
  return plugin ? PLUGIN_ID.test(m.manifest.id) : !m.manifest.id.startsWith('op-');
}

/** A known extension point is required of enabled modules only (ADR 0083, section 2.2). */
function knownKind(m: ReadModule): boolean {
  return !m.enabled || MODULE_KINDS.some((kind) => kind === m.manifest.kind);
}

/**
 * Package, core flag, extension point, id namespace, table prefix budget and extension API
 * version of each module.
 */
export function checkModules(modules: readonly ReadModule[], host: SemanticVersion): RuleProblem[] {
  const problems: RuleProblem[] = [];
  for (const m of modules) {
    const id = m.manifest.id;
    const tables = m.manifest.tablePrefix;
    const sha = m.packageSha256;
    if (m.source === 'builtin' ? sha !== null : sha === null || !SHA256.test(sha))
      problems.push({ code: 'invalid_package', module: id, subject: null });
    if (m.manifest.core && m.source !== 'builtin')
      problems.push({ code: 'core_not_builtin', module: id, subject: null });
    if (m.manifest.core && !m.enabled)
      problems.push({ code: 'core_disabled', module: id, subject: null });
    if (!knownKind(m))
      problems.push({ code: 'unknown_kind', module: id, subject: m.manifest.kind });
    if (!idFitsSource(m))
      problems.push({ code: 'id_namespace_mismatch', module: id, subject: null });
    if (tables !== null && (tables.length > MAX_TABLE_PREFIX || id.length > MAX_TABLE_OWNER_ID))
      problems.push({ code: 'table_prefix_too_long', module: id, subject: tables });
    const range = parseCaretRange(m.manifest.extensionApi);
    if (range === null || !satisfiesCaret(range, host))
      problems.push({ code: 'incompatible_api', module: id, subject: m.manifest.extensionApi });
  }
  return problems;
}

/**
 * Names a module may use. A module from outside the release serves routes only under
 * `/api/ext/<id>/v<major>/` and names tables and metrics only `arkvory_x_<id>__`, hyphens of the
 * id written as `_`; built-in modules never use those namespaces. The double `_` ends the id: an
 * id has no doubled or trailing hyphen, so `foo` (`arkvory_x_foo__`) and `foo-bar`
 * (`arkvory_x_foo_bar__`) can both be installed and a table name tells which one owns it.
 */
export function checkOwnership(modules: readonly ReadModule[]): RuleProblem[] {
  const problems: RuleProblem[] = [];
  for (const m of modules) {
    const { id, version, routePrefixes, metricPrefix, tablePrefix } = m.manifest;
    // Every source but the release itself gets the external namespaces, a future one included.
    const external = m.source !== 'builtin';
    const major = parseSemanticVersion(version)?.major ?? 0;
    const routes = `${EXTERNAL_ROUTES}${id}/v${String(major)}/`;
    const names = `${EXTERNAL_NAMES}${id.replaceAll('-', '_')}__`;
    for (const prefix of routePrefixes)
      if (external ? !prefix.startsWith(routes) : prefix.startsWith(EXTERNAL_ROUTES))
        problems.push({ code: 'route_prefix_not_owned', module: id, subject: prefix });
    for (const [code, prefix] of [
      ['metric_prefix_not_owned', metricPrefix],
      ['table_prefix_not_owned', tablePrefix],
    ] as const)
      if (prefix !== null && (external ? prefix !== names : prefix.startsWith(EXTERNAL_NAMES)))
        problems.push({ code, module: id, subject: prefix });
  }
  return problems;
}

const overlap = (a: string, b: string) => a.startsWith(b) || b.startsWith(a);

/** Each claim against every earlier one; the later module in id order is reported. */
function overlaps(
  code: ModulePlanRuleCode,
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
