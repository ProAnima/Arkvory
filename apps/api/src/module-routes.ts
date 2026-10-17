import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ArkvoryError, retentionObject } from '@proanima/arkvory-domain';
import type { Principal } from '@proanima/arkvory-domain';
import { systemModulesSchema, type SystemModules } from '@proanima/arkvory-contracts';
import type { ModuleRuntime } from './module-host.js';

/** The global administrator of this installation only: the module set shapes its attack surface. */
function administrator(actor: Principal) {
  if (actor.managed || actor.administrator !== true)
    throw new ArkvoryError('forbidden', 'Administrator required', {
      reason: 'administrator_required',
    });
}

/** The plan and this process's view of it; no settings, paths or secrets leave the server. */
export function describeModules(modules: Pick<ModuleRuntime, 'plan' | 'states'>): SystemModules {
  return {
    extensionApi: modules.plan.extensionApi,
    fingerprint: modules.plan.fingerprint,
    compatibilityFingerprint: modules.plan.compatibilityFingerprint,
    modules: modules.states().map(({ module, running, health }) => ({
      id: module.manifest.id,
      version: module.manifest.version,
      kind: module.manifest.kind,
      source: module.source,
      core: module.manifest.core,
      enabled: module.enabled,
      roles: module.manifest.roles,
      running,
      health,
    })),
  };
}

/** `GET /api/v1/system/modules` (ADR 0078, section 8; ADR 0079, section 9). */
export function registerModuleRoutes(
  app: FastifyInstance,
  principal: (request: FastifyRequest) => Principal,
  modules: Pick<ModuleRuntime, 'plan' | 'states'>,
) {
  app.get(
    '/api/v1/system/modules',
    { schema: { response: { 200: systemModulesSchema } } },
    (request) => {
      administrator(principal(request));
      retentionObject(request.query, []);
      return Promise.resolve(describeModules(modules));
    },
  );
}
