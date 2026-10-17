import {
  EXTENSION_API_VERSION,
  ModuleConfigError,
  planModules,
} from '@proanima/arkvory-extension-api';
import type {
  ModuleJson,
  ModulePlan,
  ModuleRole,
  PlannedModule,
} from '@proanima/arkvory-extension-api';
import { builtinModules, builtinVersion } from './builtin-modules.js';
import { signedRefusals } from './module-admission.js';
import type { RefusedModule, VerifiedModule } from './module-admission.js';
import { importVerifiedEntry, ModuleLoadError } from './module-import.js';
import { checkInstalledModules } from './module-loader.js';
import type { InstalledModules, InstalledModulesSource } from './module-loader.js';
import { moduleHost, ModulePlanError, prepareSelected } from './module-plan.js';
import type { PreparedModule } from './module-plan.js';
import type { ModuleSelection, ModuleSelections } from './module-selection.js';

/** The modules of a process: the plan, how to create each module, and what was refused. */
export interface InstallationPlan<Context> {
  readonly plan: ModulePlan;
  readonly prepared: ReadonlyMap<string, PreparedModule<Context>>;
  /** Installed signed modules that are not planned, with the reason, in id order. */
  readonly refused: readonly RefusedModule[];
}

/** A JSON value read back from untrusted input; anything else has no place in a fingerprint. */
function moduleJson(value: unknown, depth = 0): ModuleJson {
  if (depth > 32) throw new ModuleConfigError('invalid', '');
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((item: unknown) => moduleJson(item, depth + 1));
  if (typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, moduleJson(item, depth + 1)]),
    );
  throw new ModuleConfigError('invalid', '');
}

const notLoaded = () => {
  throw new ModuleLoadError('import_failed');
};

/**
 * A signed module as the plan sees it, before its code is loaded. Disabled unless the operator
 * enables it (ADR 0079, section 3). Its settings enter the fingerprint as written: a process
 * that does not run the module never imports it, so it could not call `describeConfig`.
 * Settings hold paths to secret files, never secrets; hosts must name the same paths.
 */
function plannedSigned<Context>(
  module: VerifiedModule,
  selection: ModuleSelection | undefined,
): PreparedModule<Context> {
  return {
    candidate: {
      manifest: module.manifest.module,
      source: 'signed',
      packageSha256: module.entry.sha256,
      enabled: selection?.enabled ?? false,
      config: moduleJson(selection?.config),
    },
    dataClass: module.manifest.package.dataClass,
    create: notLoaded,
  };
}

function refusedFrom(module: VerifiedModule, code: string): RefusedModule {
  const { id, version, kind, roles } = module.manifest.module;
  return { id, version, kind, roles, enabled: false, status: 'failed', code };
}

/**
 * Plans the built-in modules with the verified signed ones. A plan problem that names a signed
 * module (an overlapping prefix, a missing requirement, a service this core does not give, …)
 * refuses that module and the plan is made again, so a consumer of a refused provider is
 * refused in turn; every process of the host reaches the same plan. A problem of a built-in
 * module stops the start as before. Pure apart from hashing.
 */
export function planInstallation<Context>(
  coreVersion: string,
  selections: ModuleSelections,
  installed: InstalledModules,
): InstallationPlan<Context> {
  const descriptors = builtinModules(builtinVersion(coreVersion));
  const builtin = new Set(descriptors.map((d) => d.manifest.id));
  const known = new Set([
    ...builtin,
    ...installed.verified.map((m) => m.entry.id),
    ...installed.refused.map((m) => m.id),
  ]);
  const unknown = [...selections.keys()].filter((id) => !known.has(id));
  if (unknown.length > 0)
    throw new Error(`Invalid ARKVORY_MODULES_FILE: unknown module ${unknown.sort().join(', ')}`);
  const prepared = new Map<string, PreparedModule<Context>>(
    descriptors.map((d) => [d.manifest.id, prepareSelected(d, selections.get(d.manifest.id))]),
  );
  const refused = [...installed.refused];
  const signed = new Map<string, VerifiedModule>();
  for (const module of installed.verified) {
    const id = module.entry.id;
    if (builtin.has(id)) refused.push(refusedFrom(module, 'duplicate_id'));
    else {
      signed.set(id, module);
      prepared.set(id, plannedSigned(module, selections.get(id)));
    }
  }
  const host = moduleHost(coreVersion);
  for (;;) {
    const result = planModules(
      [...prepared.values()].map((m) => m.candidate),
      host,
    );
    if (result.ok) {
      const listed = refused
        .map((m) => ({ ...m, enabled: selections.get(m.id)?.enabled ?? false }))
        .sort((a, b) => (a.id < b.id ? -1 : 1));
      return { plan: result.plan, prepared, refused: listed };
    }
    const found = signedRefusals(result.problems, new Set(signed.keys()));
    if (found.size === 0) throw new ModulePlanError(result.problems);
    for (const [id, code] of found) {
      const module = signed.get(id);
      if (module) refused.push(refusedFrom(module, code));
      signed.delete(id);
      prepared.delete(id);
    }
  }
}

/** The plan of the built-in modules alone, with the operator's choices. */
export function planBuiltinModules(coreVersion: string, selections: ModuleSelections) {
  return planInstallation(coreVersion, selections, { verified: [], refused: [] });
}

/**
 * The code of one planned signed module for this process: its entry for `role`, the default
 * export checked against the signed manifest, and its settings parsed by the module. Whatever
 * fails here fails only this module in this process; `create` then throws the reason.
 */
async function loadSigned<Context>(
  module: VerifiedModule,
  planned: PreparedModule<Context>,
  role: ModuleRole,
  selection: ModuleSelection | undefined,
  budgetMs: number | undefined,
): Promise<PreparedModule<Context>> {
  const entry = module.manifest.package.entry[role];
  try {
    if (entry === undefined) throw new ModuleLoadError('descriptor_invalid');
    const descriptor = await importVerifiedEntry(
      module.directory,
      entry,
      module.manifest.module,
      budgetMs,
    );
    let config: unknown;
    try {
      config = descriptor.parseConfig(selection?.config);
    } catch (error) {
      throw new ModuleLoadError('config_invalid', { cause: error });
    }
    return {
      ...planned,
      create: (context) => {
        try {
          return descriptor.create(context, config);
        } catch (error) {
          if (error instanceof ModuleLoadError) throw error;
          throw new ModuleLoadError('create_failed', { cause: error });
        }
      },
    };
  } catch (error) {
    const failure =
      error instanceof ModuleLoadError
        ? error
        : new ModuleLoadError('import_failed', { cause: error });
    return {
      ...planned,
      create: () => {
        throw failure;
      },
    };
  }
}

export interface LoadOptions {
  readonly role: ModuleRole;
  readonly coreVersion: string;
  readonly selections: ModuleSelections;
  /** Absent: no signed module, as before the loader (Compose, development, tests). */
  readonly installed?: InstalledModulesSource | undefined;
  /** Milliseconds since the epoch, for the expiry of keys in the package check. */
  readonly now: number;
  /** How long one entry may take to import; tests shorten SIGNED_IMPORT_BUDGET_MS. */
  readonly importBudgetMs?: number | undefined;
}

/**
 * The modules of one process (ADR 0079, stage X4): every installed signed module checked before
 * its code (`checkInstalledModules`), planned with the built-in ones (`planInstallation`), and
 * the code of each enabled signed module of this process's role imported. Nothing else is
 * imported: not a disabled module, not a module of another role, not a refused one.
 */
export async function loadInstallation<Context>(
  options: LoadOptions,
): Promise<InstallationPlan<Context>> {
  const installed = options.installed
    ? await checkInstalledModules(options.installed, {
        coreVersion: options.coreVersion,
        extensionApi: EXTENSION_API_VERSION,
        now: options.now,
      })
    : { verified: [], refused: [] };
  const planned = planInstallation<Context>(options.coreVersion, options.selections, installed);
  const prepared = new Map(planned.prepared);
  for (const module of installed.verified) {
    const id = module.entry.id;
    const plannedModule = planned.plan.modules.find((m: PlannedModule) => m.manifest.id === id);
    const current = prepared.get(id);
    // A verified module the plan refused is gone from it, or its id is a built-in module's.
    if (
      plannedModule?.source !== 'signed' ||
      !plannedModule.enabled ||
      !plannedModule.manifest.roles.includes(options.role) ||
      !current
    )
      continue;
    prepared.set(
      id,
      await loadSigned(
        module,
        current,
        options.role,
        options.selections.get(id),
        options.importBudgetMs,
      ),
    );
  }
  return { ...planned, prepared };
}
