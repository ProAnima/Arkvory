import type { MetricsRegistry } from '@proanima/arkvory-infrastructure';
import type { ModuleRuntime } from './module-host.js';
import type { ModuleTelemetry } from './module-telemetry.js';

/**
 * `arkvory_module_info` and `arkvory_module_up` of the modules this process runs (ADR 0079,
 * section 4), read from their health at scrape time, and the modules' own series. A module that
 * does not run here has no series; `system/modules` lists every planned module.
 */
export function moduleMetrics(
  modules: Pick<ModuleRuntime, 'states'>,
  telemetry: Pick<ModuleTelemetry, 'register'>,
) {
  const running = () => modules.states().filter((state) => state.running);
  return {
    register(registry: MetricsRegistry): void {
      registry.sampled({
        name: 'arkvory_module_info',
        help: 'A module this process runs, with its extension point and source; always 1.',
        type: 'gauge',
        labels: ['module', 'kind', 'source'],
        collect: () =>
          running().map(({ module }) => ({
            labels: {
              module: module.manifest.id,
              kind: module.manifest.kind,
              source: module.source,
            },
            value: 1,
          })),
      });
      registry.sampled({
        name: 'arkvory_module_up',
        help: '1 while a module this process runs reports ok; 0 while it is degraded or failed.',
        type: 'gauge',
        labels: ['module'],
        collect: () =>
          running().map(({ module, health }) => ({
            labels: { module: module.manifest.id },
            value: health?.status === 'ok' ? 1 : 0,
          })),
      });
      telemetry.register(registry);
    },
  };
}
