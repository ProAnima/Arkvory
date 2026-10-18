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

const SCHEMA_REFERENCE = /^#\/components\/schemas\/(.+)$/;

/** Names of the schemas `value` refers to (`$ref`, checked by `checkFragment`). */
function references(value: unknown, found: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) references(item, found);
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  for (const [key, item] of Object.entries(value)) {
    const name = key === '$ref' && typeof item === 'string' ? SCHEMA_REFERENCE.exec(item)?.[1] : '';
    if (name) found.add(name);
    else references(item, found);
  }
}

/**
 * The schemas the shown operations reach, directly or through other schemas: the shapes of
 * operations a caller may not call are not disclosed by their components either.
 */
function reachable(
  operations: readonly unknown[],
  schemas: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const found = new Set<string>();
  references(operations, found);
  const result: Record<string, unknown> = {};
  for (const name of found) {
    if (!Object.hasOwn(schemas, name) || Object.hasOwn(result, name)) continue;
    result[name] = schemas[name];
    references(schemas[name], found);
  }
  return result;
}

/**
 * The OpenAPI 3.1 document of the module routes this process serves (ADR 0083, N12), as one
 * caller may call them: operations of administrator routes only for the global administrator,
 * on a read gateway only the reads it serves, and only the schemas those operations reach. Each
 * operation carries what the core checks before the handler; security schemes are the core's.
 * `info.version` is the plan fingerprint, so the document changes whenever the module set does.
 * `/api/v1/openapi.json` never includes module routes.
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
    const shown: unknown[] = [];
    for (const route of set.routes.filter(visible)) {
      const path = documented(route.path);
      const method = route.method.toLowerCase();
      const operation = set.fragment.paths[path]?.[method];
      if (!operation) continue;
      shown.push(operation);
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
    Object.assign(schemas, reachable(shown, set.fragment.schemas));
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
