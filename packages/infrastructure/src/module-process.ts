import type { HostServices, ModuleContext, ModuleRole } from '@proanima/arkvory-extension-api';
import type { DiagnosticRecord } from './diagnostics.js';
import type { InstallationPlan } from './module-installation.js';
import { ModuleRuntime } from './module-host.js';
import { ModuleTelemetry } from './module-telemetry.js';
import { ModuleHostServices } from './module-host-services.js';
import type { HostServiceSources } from './module-host-services.js';

export type HostedModuleContext = ModuleContext<HostServices>;

/** The composition root owns this host and closes it before its database and storage resources. */
export function processModules(
  role: Extract<ModuleRole, 'worker' | 'backup'>,
  installation: InstallationPlan<HostedModuleContext>,
  sources: HostServiceSources,
  log: { write(record: DiagnosticRecord): void },
) {
  const services = new ModuleHostServices({ ...sources, role });
  const telemetry = new ModuleTelemetry(log, () => performance.now());
  const runtime = new ModuleRuntime(
    installation.plan,
    installation.prepared,
    {
      role,
      context: (module, signal, capabilities): HostedModuleContext => ({
        role,
        source: module.source,
        mode: sources.readOnly ? 'read-only' : 'full',
        signal,
        capabilities,
        log: telemetry.log(module.manifest),
        metrics: telemetry.metrics(module.manifest),
        services: services.for(
          module,
          installation.prepared.get(module.manifest.id)?.resources ?? null,
        ),
      }),
      created: (module) => {
        services.seal(module.manifest.id);
      },
      activated: (module) => {
        services.activate(module.manifest.id);
      },
      withdrawn: (id) => {
        services.withdraw(id);
      },
    },
    installation.refused,
  );
  return {
    runtime,
    services,
    close: async () => {
      try {
        await runtime.shutdown(10_000);
      } finally {
        await services.close();
      }
    },
  };
}
