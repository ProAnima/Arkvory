import { HOST_SERVICES, type HostService } from './context.js';
import type { ModuleSource } from './sources.js';
import type { ModuleRole } from './manifest.js';
import type { ReadModule, RuleProblem } from './plan-rules.js';

interface Availability {
  /** Processes that offer the service. */
  readonly roles: readonly ModuleRole[];
  /** Whether operator and development plugins in the process may use it. */
  readonly plugins: boolean;
}

const servers: readonly ModuleRole[] = ['api', 'reader', 'worker', 'backup'];

/**
 * Where each service exists and who may use it (ADR 0083, section 16). Reading the catalog and
 * content, the feed, the data directory, routes and the compute pool are open to plugins in the
 * process; the blob store, completion from stored parts and the license view are not. Completion
 * from parts is allowed to plugins with `dataClass: layout` only, a field manifests do not have
 * yet; the license view is closed to plugins by ADR 0082, section 18.
 */
const AVAILABILITY: Readonly<Record<HostService, Availability>> = {
  'blob-store': { roles: servers, plugins: false },
  'staged-completion': { roles: ['api', 'worker'], plugins: false },
  'catalog-read': { roles: ['api', 'reader', 'worker'], plugins: true },
  'upload-read': { roles: ['api', 'reader'], plugins: true },
  'content-read': { roles: ['api', 'reader', 'worker'], plugins: true },
  'change-feed': { roles: ['worker'], plugins: true },
  // A read gateway gets its data directory read-only.
  'data-directory': { roles: servers, plugins: true },
  routes: { roles: ['api', 'reader'], plugins: true },
  compute: { roles: ['api', 'worker', 'backup'], plugins: true },
  license: { roles: servers, plugins: false },
};

const PLUGIN_SOURCES: readonly ModuleSource[] = ['operator', 'development'];

function availability(name: string): Availability | undefined {
  const service = HOST_SERVICES.find((known) => known === name);
  return service === undefined ? undefined : AVAILABILITY[service];
}

/**
 * Every service an enabled module uses must be known, provided by this host, offered in every
 * process the module runs in and open to the module's source. A disabled module is not checked:
 * it may be written for a later contract whose services this core does not know yet.
 */
export function checkServices(
  modules: readonly ReadModule[],
  provided: readonly HostService[],
): RuleProblem[] {
  const problems: RuleProblem[] = [];
  for (const m of modules.filter((candidate) => candidate.enabled)) {
    const plugin = PLUGIN_SOURCES.includes(m.source);
    for (const name of m.manifest.uses) {
      const found = availability(name);
      const usable =
        found !== undefined &&
        provided.some((service) => service === name) &&
        m.manifest.roles.every((role) => found.roles.includes(role)) &&
        (found.plugins || !plugin);
      if (!usable)
        problems.push({ code: 'service_unavailable', module: m.manifest.id, subject: name });
    }
  }
  return problems;
}
