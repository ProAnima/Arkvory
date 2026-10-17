import type { ModuleContext, ModuleSignal, PlannedModule } from '@proanima/arkvory-extension-api';
import { planBuiltinModules } from '@proanima/arkvory-infrastructure';
import type { ModuleSelections } from '@proanima/arkvory-infrastructure';
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
 * Plans the modules of this API process from the built-in list and the operator's choices
 * (`ARKVORY_MODULES_FILE`). No I/O: each configuration is parsed and the plan checked before
 * anything is allocated; `ModuleRuntime.start` then starts them. Without choices every built-in
 * module is enabled, as before modules existed.
 */
export function planApiModules(
  role: ApiModuleContext['role'],
  coreVersion: string,
  selections: ModuleSelections = new Map(),
  // Tests plan without a process log; a server passes the telemetry bound to its own.
  telemetry = new ModuleTelemetry({ write: () => undefined }, () => performance.now()),
): ModuleRuntime<ApiModuleContext> {
  const { plan, prepared } = planBuiltinModules(coreVersion, selections);
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
  return new ModuleRuntime<ApiModuleContext>(plan, prepared, { role, context });
}
