import { hostServiceAvailable } from '@proanima/arkvory-extension-api';
import type {
  HostServices,
  ModuleCapabilities,
  ModuleContext,
  ModuleResources,
  ModuleSignal,
  PlannedModule,
} from '@proanima/arkvory-extension-api';
import { planBuiltinModules } from '@proanima/arkvory-infrastructure';
import type { InstallationPlan, ModuleSelections } from '@proanima/arkvory-infrastructure';
import { ModuleRouteRegistry } from './extension-registry.js';
import { ModuleRuntime } from './module-host.js';
import { ModuleTelemetry } from './module-telemetry.js';

/**
 * Services the API process gives modules (`HOST_SERVICES`, ADR 0083): `routes` (N7), reading
 * the catalog and content (N4) and the data directory (N6); each module receives only those its
 * manifest declares, every other service is refused by the plan.
 */
export type ApiServices = HostServices;

/** The host services of one module other than `routes`, built right before its `create`. */
export type ModuleServicesOf = (
  module: PlannedModule,
  resources: ModuleResources | null,
) => Omit<ApiServices, 'routes'>;

/** What a module of the API process receives from the core (ADR 0083, section 2.4). */
export type ApiModuleContext = ModuleContext<ApiServices> & { readonly role: 'api' | 'reader' };

const usesRoutes = (module: PlannedModule) =>
  module.manifest.uses.includes('routes') &&
  module.manifest.roles.some((role) => hostServiceAvailable('routes', role, module.source));

/**
 * The modules of this API process from a loaded installation (`loadInstallation`): the built-in
 * list, the operator's choices (`ARKVORY_MODULES_FILE`) and the installed signed modules. No I/O:
 * each configuration was parsed and the plan checked before anything is allocated;
 * `ModuleRuntime.start` then starts them. What a module declares through `routes` lands in
 * `registry`, checked right after its `create`.
 */
export function apiModules(
  role: ApiModuleContext['role'],
  installation: InstallationPlan<ApiModuleContext>,
  telemetry: ModuleTelemetry,
  registry = new ModuleRouteRegistry(),
  services: ModuleServicesOf = () => ({}),
  hooks?: { seal(id: string): void; activate(id: string): void; withdraw(id: string): void },
): ModuleRuntime<ApiModuleContext> {
  const context = (
    module: PlannedModule,
    signal: ModuleSignal,
    capabilities: ModuleCapabilities,
  ): ApiModuleContext => ({
    role,
    source: module.source,
    // A read gateway serves reads only (ADR 0009); its modules refuse writes with read_only.
    mode: role === 'api' ? 'full' : 'read-only',
    signal,
    log: telemetry.log(module.manifest),
    metrics: telemetry.metrics(module.manifest),
    services: {
      ...services(module, installation.prepared.get(module.manifest.id)?.resources ?? null),
      ...(usesRoutes(module) ? { routes: registry.service(module.manifest) } : {}),
    },
    capabilities,
  });
  const created = (module: PlannedModule) => {
    if (usesRoutes(module)) registry.seal(module.manifest);
    hooks?.seal(module.manifest.id);
  };
  return new ModuleRuntime<ApiModuleContext>(
    installation.plan,
    installation.prepared,
    {
      role,
      context,
      created,
      activated: (m) => hooks?.activate(m.manifest.id),
      withdrawn: (id) => hooks?.withdraw(id),
    },
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
  registry = new ModuleRouteRegistry(),
): ModuleRuntime<ApiModuleContext> {
  return apiModules(role, planBuiltinModules(coreVersion, selections), telemetry, registry);
}
