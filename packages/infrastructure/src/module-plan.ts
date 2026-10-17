import { createHash } from 'node:crypto';
import {
  EXTENSION_API_VERSION,
  ModuleConfigError,
  planModules,
} from '@proanima/arkvory-extension-api';
import type {
  HostService,
  ModuleCandidate,
  ModuleDescriptor,
  ModuleHost,
  ModuleLifecycle,
  ModulePlan,
  ModulePlanProblem,
} from '@proanima/arkvory-extension-api';
import { builtinModules, builtinVersion, CORE_ROUTE_PREFIXES } from './builtin-modules.js';
import type { ModuleSelection, ModuleSelections } from './module-selection.js';

/** A descriptor with its configuration parsed: what the plan reads and what `create` builds. */
export interface PreparedModule<Context> {
  readonly candidate: ModuleCandidate;
  create(context: Context): ModuleLifecycle;
}

const DEFAULT_SELECTION: ModuleSelection = { enabled: true, config: undefined };

/** Parses the configuration before anything starts; a `ModuleConfigError` stops the start. */
export function prepareModule<Context, Config>(
  descriptor: ModuleDescriptor<Context, Config>,
  selection: ModuleSelection = DEFAULT_SELECTION,
): PreparedModule<Context> {
  const config = descriptor.parseConfig(selection.config);
  return {
    candidate: {
      manifest: descriptor.manifest,
      source: 'builtin',
      packageSha256: null,
      enabled: selection.enabled,
      config: descriptor.describeConfig(config),
    },
    create: (context) => descriptor.create(context, config),
  };
}

/** A refused plan; the message lists machine codes and module ids only. */
export class ModulePlanError extends Error {
  override readonly name = 'ModulePlanError';
  constructor(readonly problems: readonly ModulePlanProblem[]) {
    super(
      `Module plan refused: ${problems.map((p) => `${p.code}(${p.module ?? p.subject})`).join(', ')}`,
    );
  }
}

export function planOrThrow<Context>(
  prepared: ReadonlyMap<string, PreparedModule<Context>>,
  host: ModuleHost,
): ModulePlan {
  const result = planModules(
    [...prepared.values()].map((module) => module.candidate),
    host,
  );
  if (!result.ok) throw new ModulePlanError(result.problems);
  return result.plan;
}

/**
 * Services of ADR 0083 this core implements for modules. None yet: each arrives with its stage
 * and contract suite, and a module that uses another one is refused (`service_unavailable`).
 */
export const PROVIDED_HOST_SERVICES: readonly HostService[] = [];

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/** The settings of a module as `ARKVORY_MODULES_FILE` gives them, by their path in the file. */
function prepareSelected<Context, Config>(
  descriptor: ModuleDescriptor<Context, Config>,
  selection: ModuleSelection | undefined,
): PreparedModule<Context> {
  try {
    return prepareModule(descriptor, selection);
  } catch (error) {
    if (!(error instanceof ModuleConfigError)) throw error;
    const path = `/modules/${descriptor.manifest.id}/config${error.path}`;
    throw new Error(`Invalid ARKVORY_MODULES_FILE: ${path}: ${error.code}`, { cause: error });
  }
}

/**
 * The plan of the built-in modules with the operator's choices. Pure apart from hashing: every
 * process of an installation that reads the same file plans the same modules and computes the
 * same fingerprint. A choice for a module this release does not have stops the start.
 */
export function planBuiltinModules(coreVersion: string, selections: ModuleSelections) {
  const descriptors = builtinModules(builtinVersion(coreVersion));
  const unknown = [...selections.keys()].filter(
    (id) => !descriptors.some((descriptor) => descriptor.manifest.id === id),
  );
  if (unknown.length > 0)
    throw new Error(`Invalid ARKVORY_MODULES_FILE: unknown module ${unknown.sort().join(', ')}`);
  const prepared = new Map(
    descriptors.map((descriptor) => [
      descriptor.manifest.id,
      prepareSelected(descriptor, selections.get(descriptor.manifest.id)),
    ]),
  );
  const plan = planOrThrow(prepared, {
    coreVersion,
    extensionApi: EXTENSION_API_VERSION,
    reservedRoutePrefixes: CORE_ROUTE_PREFIXES,
    sha256,
    services: PROVIDED_HOST_SERVICES,
  });
  return { plan, prepared };
}
