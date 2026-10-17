import { canonicalJson, type ModuleJson } from './json.js';
import {
  MODULE_MANIFEST_FORMAT,
  ModuleManifestError,
  parseModuleManifest,
  type ModuleManifest,
  type ModuleManifestProblem,
} from './manifest.js';
import { startOrder } from './plan-order.js';
import {
  checkModules,
  checkOverlaps,
  checkOwnership,
  type ReadModule,
  type RuleCode,
} from './plan-rules.js';

/** Built into the core release, or installed as a package signed by ProAnimaStudio. */
export type ModuleSource = 'builtin' | 'signed';

/** One module offered to the plan, with the operator's choice and its normalized settings. */
export interface ModuleCandidate {
  /** Read with `parseModuleManifest`; untrusted until then. */
  readonly manifest: unknown;
  readonly source: ModuleSource;
  /** Lowercase hex SHA-256 of the signed package; null for built-in modules. */
  readonly packageSha256: string | null;
  readonly enabled: boolean;
  /** `describeConfig` of the parsed configuration. */
  readonly config: ModuleJson;
}

/** What the planning process knows of itself. */
export interface ModuleHost {
  /** Release version of the core; part of the fingerprint. */
  readonly coreVersion: string;
  /** The extension API version the core implements, normally `EXTENSION_API_VERSION`. */
  readonly extensionApi: string;
  /** Route prefixes of the core itself, which no module may overlap. */
  readonly reservedRoutePrefixes: readonly string[];
  /** Lowercase hex SHA-256 of UTF-8 text; the contract has no hashing of its own. */
  readonly sha256: (text: string) => string;
}

export interface PlannedModule {
  readonly manifest: ModuleManifest;
  readonly source: ModuleSource;
  readonly packageSha256: string | null;
  readonly enabled: boolean;
}

export interface ModulePlan {
  readonly coreVersion: string;
  readonly extensionApi: string;
  /** Every candidate, enabled or not, in id order. */
  readonly modules: readonly PlannedModule[];
  /** Ids of enabled modules, providers before consumers, ties by id. */
  readonly startOrder: readonly string[];
  /** `startOrder` reversed. */
  readonly stopOrder: readonly string[];
  /**
   * SHA-256 of the core version, the extension API version and every module's id, version,
   * source, package hash, choice and normalized configuration. Equal plans on every process of
   * an installation give an equal fingerprint.
   */
  readonly fingerprint: string;
}

export type ModulePlanProblemCode = 'invalid_manifest' | 'duplicate_id' | RuleCode;

export type ModulePlanProblem =
  | {
      readonly code: 'invalid_manifest';
      readonly module: null;
      /** JSON Pointer into the candidate list, such as `/2/routePrefixes/0`. */
      readonly subject: string;
      readonly reason: ModuleManifestProblem;
    }
  | {
      readonly code: Exclude<ModulePlanProblemCode, 'invalid_manifest'>;
      readonly module: string;
      /** The capability, prefix or range concerned, when there is one. */
      readonly subject: string | null;
    };

export type ModulePlanResult =
  | { readonly ok: true; readonly plan: ModulePlan }
  | { readonly ok: false; readonly problems: readonly ModulePlanProblem[] };

interface Candidate extends ReadModule {
  readonly config: ModuleJson;
}

function readCandidates(candidates: readonly ModuleCandidate[]) {
  const problems: ModulePlanProblem[] = [];
  const modules: Candidate[] = [];
  candidates.forEach((candidate, index) => {
    try {
      const manifest = parseModuleManifest(candidate.manifest);
      if (modules.some((m) => m.manifest.id === manifest.id))
        problems.push({ code: 'duplicate_id', module: manifest.id, subject: null });
      else modules.push({ ...candidate, manifest });
    } catch (error) {
      if (!(error instanceof ModuleManifestError)) throw error;
      const subject = `/${String(index)}${error.path}`;
      problems.push({ code: 'invalid_manifest', module: null, subject, reason: error.code });
    }
  });
  modules.sort((a, b) => (a.manifest.id < b.manifest.id ? -1 : 1));
  return { modules, problems };
}

function fingerprint(modules: readonly Candidate[], host: ModuleHost): string {
  const digest = host.sha256(
    canonicalJson({
      format: MODULE_MANIFEST_FORMAT,
      core: host.coreVersion,
      extensionApi: host.extensionApi,
      modules: modules.map((m) => ({
        id: m.manifest.id,
        version: m.manifest.version,
        source: m.source,
        sha256: m.packageSha256,
        enabled: m.enabled,
        config: m.config,
      })),
    }),
  );
  if (!/^[0-9a-f]{64}$/.test(digest)) throw new TypeError('Invalid plan digest');
  return digest;
}

/**
 * Checks a set of modules and orders their start. Pure: no I/O, no clock; the same candidates
 * and host always give the same result. Every problem found is reported, not only the first.
 */
export function planModules(
  candidates: readonly ModuleCandidate[],
  host: ModuleHost,
): ModulePlanResult {
  const { modules, problems } = readCandidates(candidates);
  if (problems.length > 0) return { ok: false, problems };
  const found = [
    ...checkModules(modules, host.extensionApi),
    ...checkOwnership(modules),
    ...checkOverlaps(modules, host.reservedRoutePrefixes),
  ];
  const order = startOrder(modules, found);
  if (found.length > 0) return { ok: false, problems: found };
  return {
    ok: true,
    plan: {
      coreVersion: host.coreVersion,
      extensionApi: host.extensionApi,
      modules: modules.map(({ manifest, source, packageSha256, enabled }) => ({
        manifest,
        source,
        packageSha256,
        enabled,
      })),
      startOrder: order,
      stopOrder: [...order].reverse(),
      fingerprint: fingerprint(modules, host),
    },
  };
}
