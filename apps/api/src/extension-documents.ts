import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ArkvoryError, requireAdministrator, retentionObject } from '@proanima/arkvory-domain';
import type { Principal } from '@proanima/arkvory-domain';
import { nativeErrorSchema } from '@proanima/arkvory-contracts';
import type { ModuleRouteSet } from './extension-registry.js';
import type { CheckedRoute } from './extension-route-check.js';

/** The combined document of module routes, outside `/api/v1` and its inventory. */
export const EXTENSION_DOCUMENT_PATH = '/api/ext/openapi.json';

const isAdministrator = (principal: Principal) => {
  try {
    requireAdministrator(principal);
    return true;
  } catch {
    return false;
  }
};

const documented = (path: string) => path.replace(/:([a-zA-Z0-9]+)/g, '{$1}');

/**
 * The OpenAPI 3.1 document of the module routes this process serves (ADR 0083, N12), as one
 * caller may call them: operations of administrator routes only for the global administrator,
 * on a read gateway only the reads it serves. Each operation carries what the core checks
 * before the handler; security schemes are the core's. `info.version` is the plan fingerprint,
 * so the document changes whenever the module set does. `/api/v1/openapi.json` never includes
 * module routes.
 */
export function extensionDocument(
  sets: readonly ModuleRouteSet[],
  fingerprint: string,
  visible: (route: CheckedRoute) => boolean,
) {
  const paths: Record<string, Record<string, unknown>> = {};
  const schemas: Record<string, unknown> = {};
  for (const set of sets) {
    if (!set.fragment) continue;
    Object.assign(schemas, set.fragment.schemas);
    for (const route of set.routes.filter(visible)) {
      const path = documented(route.path);
      const method = route.method.toLowerCase();
      const operation = set.fragment.paths[path]?.[method];
      if (!operation) continue;
      paths[path] = {
        ...paths[path],
        [method]: {
          ...operation,
          security: [{ serviceKey: [] }],
          'x-arkvory-module': route.module,
          'x-arkvory-effect': route.effect,
          'x-arkvory-action': route.action,
          'x-arkvory-repository-param': route.repositoryParam,
        },
      };
    }
  }
  return {
    openapi: '3.1.0',
    info: { title: 'ProAnima Arkvory module routes', version: fingerprint },
    security: [{ serviceKey: [] }],
    components: {
      securitySchemes: {
        serviceKey: {
          type: 'http',
          scheme: 'bearer',
          description: 'Service key or account session',
        },
      },
      schemas: { NativeError: nativeErrorSchema, ...schemas },
    },
    paths,
  };
}

/** What the module documents need from the process. */
export interface ExtensionDocuments {
  readonly role: 'api' | 'reader';
  readonly fingerprint: string;
  /** Route sets of the modules running in this process. */
  readonly sets: readonly ModuleRouteSet[];
}

/**
 * `GET /api/ext/openapi.json` for every authenticated caller, and the fragment of one module,
 * `GET /api/v1/system/modules/{id}/openapi`, for the global administrator (ADR 0078, section 8;
 * ADR 0083, N12). A module that serves no routes in this process has no fragment here.
 */
export function registerExtensionDocuments(
  app: FastifyInstance,
  principal: (request: FastifyRequest) => Principal,
  documents: ExtensionDocuments,
) {
  const served = (route: CheckedRoute) => documents.role === 'api' || route.effect === 'read';
  app.get(EXTENSION_DOCUMENT_PATH, (request) => {
    const caller = principal(request);
    retentionObject(request.query, []);
    const administrator = isAdministrator(caller);
    return Promise.resolve(
      extensionDocument(
        documents.sets,
        documents.fingerprint,
        (route) => served(route) && (route.access !== 'administrator' || administrator),
      ),
    );
  });
  app.get<{ Params: { id: string } }>('/api/v1/system/modules/:id/openapi', (request) => {
    requireAdministrator(principal(request));
    retentionObject(request.query, []);
    const set = documents.sets.find((s) => s.module === request.params.id);
    if (!set?.fragment) throw new ArkvoryError('not_found', 'The module documents no routes here');
    return Promise.resolve(extensionDocument([set], documents.fingerprint, served));
  });
}
