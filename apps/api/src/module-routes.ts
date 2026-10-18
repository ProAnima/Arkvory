import type { FastifyInstance, FastifyRequest } from 'fastify';
import { retentionObject, requireAdministrator } from '@proanima/arkvory-domain';
import type { Principal } from '@proanima/arkvory-domain';
import { systemModulesSchema, type SystemModules } from '@proanima/arkvory-contracts';
import type { ModuleRuntime } from './module-host.js';

type ModuleView = Pick<ModuleRuntime, 'plan' | 'states' | 'refused'>;

/**
 * The plan and this process's view of it, and the installed signed modules the loader refused
 * with the reason; no settings, paths or secrets leave the server. A refused module whose
 * signature did not verify has no trusted kind or roles: `unknown` and none.
 */
export function describeModules(modules: ModuleView): SystemModules {
  const planned = modules.states().map(({ module, running, health }) => ({
    id: module.manifest.id,
    version: module.manifest.version,
    kind: module.manifest.kind,
    source: module.source,
    core: module.manifest.core,
    enabled: module.enabled,
    roles: module.manifest.roles,
    running,
    health,
  }));
  const refused = modules.refused.map((module) => ({
    id: module.id,
    version: module.version,
    kind: module.kind ?? 'unknown',
    source: 'signed',
    core: false,
    enabled: module.enabled,
    roles: module.roles,
    running: false,
    health: { status: module.status, code: module.code },
  }));
  return {
    extensionApi: modules.plan.extensionApi,
    fingerprint: modules.plan.fingerprint,
    compatibilityFingerprint: modules.plan.compatibilityFingerprint,
    modules: [...planned, ...refused].sort((a, b) => (a.id < b.id ? -1 : 1)),
  };
}

/** `GET /api/v1/system/modules` (ADR 0078, section 8; ADR 0079, section 9). */
export function registerModuleRoutes(
  app: FastifyInstance,
  principal: (request: FastifyRequest) => Principal,
  modules: ModuleView,
) {
  app.get(
    '/api/v1/system/modules',
    { schema: { response: { 200: systemModulesSchema } } },
    (request) => {
      requireAdministrator(principal(request));
      retentionObject(request.query, []);
      return Promise.resolve(describeModules(modules));
    },
  );
}
