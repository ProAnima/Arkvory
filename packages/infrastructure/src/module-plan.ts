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
  ModuleResources,
} from '@proanima/arkvory-extension-api';
import type { DataClass } from '@proanima/arkvory-signing';
import { CORE_ROUTE_PREFIXES } from './builtin-modules.js';
import type { ModuleSelection } from './module-selection.js';

/** A descriptor with its configuration parsed: what the plan reads and what `create` builds. */
export interface PreparedModule<Context> {
  readonly candidate: ModuleCandidate;
  /** What a signed package stores (ADR 0078, I1); null for built-in modules. */
  readonly dataClass: DataClass | null;
  /**
   * The data directory the module may fill (ADR 0083, N6): the operator's approval in
   * `ARKVORY_MODULES_FILE`, else the manifest's request; null for none.
   */
  readonly resources?: ModuleResources | null;
  /**
   * Builds the instance. For a signed module whose code could not be loaded in this process it
   * throws `ModuleLoadError`; the host then reports the module failed instead of running it.
   */
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
    dataClass: null,
    resources: approvedResources(descriptor.manifest.resources, selection),
    create: (context) => descriptor.create(context, config),
  };
}

/** The operator's approval replaces the manifest's request of a data directory. */
export function approvedResources(
  requested: ModuleResources | null,
  selection: ModuleSelection | undefined,
): ModuleResources | null {
  return selection?.resources ?? requested;
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
 * Services of ADR 0083 this core implements for modules, each with its contract suite in
 * `extension-testkit`; a module that uses another one is refused (`service_unavailable`).
 * Completion from stored parts is a capability of a storage instance the core builds, not yet a
 * service a module can offer (`staged-completion` waits for storage instances of modules).
 */
export const PROVIDED_HOST_SERVICES: readonly HostService[] = [
  'catalog-read',
  'content-read',
  'data-directory',
];

export const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/** The settings of a module as `ARKVORY_MODULES_FILE` gives them, by their path in the file. */
export function prepareSelected<Context, Config>(
  descriptor: ModuleDescriptor<Context, Config>,
  selection: ModuleSelection | undefined,
): PreparedModule<Context> {
  try {
    return prepareModule(descriptor, selection);
  } catch (error) {
    if (!(error instanceof ModuleConfigError)) throw error;
    const path = `/modules/${descriptor.manifest.id}/config${error.path}`;
    // The code before the pointer: a field named `token` or `key` must not hide it in the log.
    throw new Error(`Invalid ARKVORY_MODULES_FILE: ${error.code} ${path}`, { cause: error });
  }
}

/** What every process of this release tells the plan about itself. */
export function moduleHost(coreVersion: string): ModuleHost {
  return {
    coreVersion,
    extensionApi: EXTENSION_API_VERSION,
    reservedRoutePrefixes: CORE_ROUTE_PREFIXES,
    sha256,
    services: PROVIDED_HOST_SERVICES,
  };
}
