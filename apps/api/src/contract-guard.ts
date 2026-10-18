import type { FastifyInstance } from 'fastify';
import { apiOperations, assertRouteInventory } from '@proanima/arkvory-contracts';
import type { RuntimeRoute } from '@proanima/arkvory-contracts';
import type { PlannedModule } from '@proanima/arkvory-extension-api';
import { EXTENSION_DOCUMENT_PATH } from './extension-documents.js';

// Exact static exclusions. A new API beneath /console/ must not silently escape inventory.
const staticPaths = [
  '/console/arkvory.svg',
  '/console/arkvory.ico',
  '/console/arkvory.png',
  '/console/',
  '/console/THIRD-PARTY.txt',
  '/console/console.js',
  '/console/hash-worker.js',
  '/console/style.css',
  '/console/tokens.css',
  '/console/appearance-init.js',
  '/console/locales/:file',
  '/console/flags/:file',
  // The combined document of module routes (ADR 0083, N12), beside their own inventory below.
  EXTENSION_DOCUMENT_PATH,
];
const exclusions = staticPaths.flatMap((url) => ['GET', 'HEAD'].map((method) => ({ method, url })));

const key = (route: RuntimeRoute) => `${route.method.toUpperCase()} ${route.url}`;

/**
 * Routes of a module that declared them through the service `routes` (ADR 0083, N12) against
 * what the router holds under its prefixes, both ways: each declared route is registered and
 * nothing else is. A `GET` route answers `HEAD` as well.
 */
function declaredDrift(
  routes: readonly RuntimeRoute[],
  module: PlannedModule,
  declared: readonly RuntimeRoute[],
): string[] {
  const own = (route: RuntimeRoute) =>
    module.manifest.routePrefixes.some((prefix) => route.url.startsWith(prefix));
  const expected = new Set(
    declared.flatMap((route) =>
      route.method === 'GET' ? [key(route), key({ ...route, method: 'HEAD' })] : [key(route)],
    ),
  );
  const actual = new Set(routes.filter(own).map(key));
  return [
    ...[...actual].filter((route) => !expected.has(route)).map((r) => `undocumented ${r}`),
    ...[...expected].filter((route) => !actual.has(route)).map((r) => `unregistered ${r}`),
  ];
}

/**
 * Routes beside /api/v1 belong to the modules that declare their prefixes (ADR 0079, 5.7): the
 * image registry follows the OCI Distribution specification (ADR 0063), Git LFS its batch,
 * transfer and locking APIs (ADR 0065), npm its registry protocol (ADR 0066), and modules with
 * the service `routes` their declared routes. A route under no running module's prefix is
 * checked against the /api/v1 inventory and fails as undocumented, so a disabled protocol or a
 * module that failed to start cannot leave a route behind; a running protocol module that
 * registered nothing under one of its prefixes fails too.
 */
export function moduleRoutes(
  routes: readonly RuntimeRoute[],
  modules: readonly PlannedModule[],
  declared: ReadonlyMap<string, readonly RuntimeRoute[]>,
) {
  const drift = modules.flatMap((m) => {
    const own = declared.get(m.manifest.id);
    return own ? declaredDrift(routes, m, own) : [];
  });
  if (drift.length > 0) throw new Error(`API route drift: module routes [${drift.join(', ')}]`);
  const protocols = modules.filter((m) => !declared.has(m.manifest.id));
  const prefixes = protocols.flatMap((m) => m.manifest.routePrefixes);
  const idle = prefixes.filter((prefix) => !routes.some((route) => route.url.startsWith(prefix)));
  if (idle.length > 0)
    throw new Error(`API route drift: module prefixes without routes [${idle.join(', ')}]`);
  const owned = modules.flatMap((m) => m.manifest.routePrefixes);
  return routes.filter((route) => !owned.some((prefix) => route.url.startsWith(prefix)));
}

/**
 * `modules`: the running modules of this process, whose prefixes it serves; `declared`: the
 * routes this process serves for each module with the service `routes`, by module id.
 */
export function registerContractGuard(
  app: FastifyInstance,
  modules: readonly PlannedModule[],
  declared: ReadonlyMap<string, readonly RuntimeRoute[]> = new Map(),
): void {
  const routes: RuntimeRoute[] = [];
  app.addHook('onRoute', (options) => {
    for (const method of Array.isArray(options.method) ? options.method : [options.method])
      routes.push({ method, url: options.url });
  });
  app.addHook('onReady', () =>
    Promise.resolve().then(() => {
      assertRouteInventory(moduleRoutes(routes, modules, declared), apiOperations, exclusions);
    }),
  );
}
