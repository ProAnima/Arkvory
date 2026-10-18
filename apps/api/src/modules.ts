import type { ModuleContext, ModuleSignal, PlannedModule } from '@proanima/arkvory-extension-api';
import { planBuiltinModules } from '@proanima/arkvory-infrastructure';
import type { InstallationPlan, ModuleSelections } from '@proanima/arkvory-infrastructure';
import { ModuleRuntime } from './module-host.js';
import { ModuleTelemetry } from './module-telemetry.js';

/**
 * Services the API process gives modules (`HOST_SERVICES`, ADR 0083); none is implemented yet,
 * so the plan refuses a module that uses one and every module receives an empty object.
 */
export type ApiServices = Readonly<Record<string, never>>;

/** What a module of the API process receives from the core (ADR 0083, section 2.4). */
export type ApiModuleContext = ModuleContext<ApiServices> & { readonly role: 'api' | 'reader' };

/**
 * The modules of this API process from a loaded installation (`loadInstallation`): the built-in
 * list, the operator's choices (`ARKVORY_MODULES_FILE`) and the installed signed modules. No I/O:
 * each configuration was parsed and the plan checked before anything is allocated;
 * `ModuleRuntime.start` then starts them.
 */
export function apiModules(
  role: ApiModuleContext['role'],
  installation: InstallationPlan<ApiModuleContext>,
  telemetry: ModuleTelemetry,
): ModuleRuntime<ApiModuleContext> {
  const context = (module: PlannedModule, signal: ModuleSignal): ApiModuleContext => ({
    role,
    source: module.source,
    // A read gateway serves reads only (ADR 0009); its modules refuse writes with read_only.
    mode: role === 'api' ? 'full' : 'read-only',
    signal,
    log: telemetry.log(module.manifest),
    metrics: telemetry.metrics(module.manifest),
    services: {},
  });
  return new ModuleRuntime<ApiModuleContext>(
    installation.plan,
    installation.prepared,
    { role, context },
    installation.refused,
  );
}

/**
 * The built-in modules alone with the operator's choices. Without choices every built-in module
 * is enabled, as before modules existed.
 */
export function planApiModules(
  role: ApiModuleContext['role'],
  coreVersion: string,
  selections: ModuleSelections = new Map(),
  // Tests plan without a process log; a server passes the telemetry bound to its own.
  telemetry = new ModuleTelemetry({ write: () => undefined }, () => performance.now()),
): ModuleRuntime<ApiModuleContext> {
  return apiModules(role, planBuiltinModules(coreVersion, selections), telemetry);
}
