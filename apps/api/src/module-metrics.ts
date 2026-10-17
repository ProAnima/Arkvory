import type { MetricsRegistry } from '@proanima/arkvory-infrastructure';
import type { ModuleRuntime } from './module-host.js';
import type { ModuleTelemetry } from './module-telemetry.js';

/**
 * `arkvory_module_info` and `arkvory_module_up` of the modules that belong to this process (ADR
 * 0079, section 4), read from their health at scrape time, and the modules' own series. A
 * module that runs here reports its health; a signed module that should run here but failed to
 * load or start, and an enabled signed module the loader refused, report 0. A module that does
 * not belong to this process has no series; `system/modules` lists every module.
 */
export function moduleMetrics(
  modules: Pick<ModuleRuntime, 'states' | 'refused'>,
  telemetry: Pick<ModuleTelemetry, 'register'>,
) {
  const series = () => [
    ...modules
      .states()
      .filter((state) => state.health !== null)
      .map(({ module, health }) => ({
        module: module.manifest.id,
        kind: module.manifest.kind,
        source: module.source,
        up: health?.status === 'ok' ? 1 : 0,
      })),
    ...modules.refused
      .filter((module) => module.enabled)
      .map((module) => ({
        module: module.id,
        kind: module.kind ?? 'unknown',
        source: 'signed',
        up: 0,
      })),
  ];
  return {
    register(registry: MetricsRegistry): void {
      registry.sampled({
        name: 'arkvory_module_info',
        help: 'A module of this process, with its extension point and source; always 1.',
        type: 'gauge',
        labels: ['module', 'kind', 'source'],
        collect: () =>
          series().map(({ module, kind, source }) => ({
            labels: { module, kind, source },
            value: 1,
          })),
      });
      registry.sampled({
        name: 'arkvory_module_up',
        help: '1 while a module of this process reports ok; 0 while it is degraded, failed or refused.',
        type: 'gauge',
        labels: ['module'],
        collect: () => series().map(({ module, up }) => ({ labels: { module }, value: up })),
      });
      telemetry.register(registry);
    },
  };
}
