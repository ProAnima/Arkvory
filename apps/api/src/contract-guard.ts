import type { FastifyInstance } from 'fastify';
import { apiOperations, assertRouteInventory } from '@proanima/arkvory-contracts';
import type { RuntimeRoute } from '@proanima/arkvory-contracts';
import type { PlannedModule } from '@proanima/arkvory-extension-api';

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
];
const exclusions = staticPaths.flatMap((url) => ['GET', 'HEAD'].map((method) => ({ method, url })));

/**
 * Routes beside /api/v1 belong to the protocol modules that declare their prefixes (ADR 0079,
 * 5.7): the image registry follows the OCI Distribution specification (ADR 0063), Git LFS its
 * batch, transfer and locking APIs (ADR 0065), npm its registry protocol (ADR 0066). A route under
 * no enabled module's prefix is checked against the /api/v1 inventory and fails as undocumented,
 * so a disabled protocol cannot leave a route behind; an enabled module that registered nothing
 * under one of its prefixes fails too.
 */
function moduleRoutes(routes: readonly RuntimeRoute[], modules: readonly PlannedModule[]) {
  const prefixes = modules.flatMap((m) => m.manifest.routePrefixes);
  const owned = (route: RuntimeRoute) => prefixes.some((prefix) => route.url.startsWith(prefix));
  const idle = prefixes.filter((prefix) => !routes.some((route) => route.url.startsWith(prefix)));
  if (idle.length > 0)
    throw new Error(`API route drift: module prefixes without routes [${idle.join(', ')}]`);
  return routes.filter((route) => !owned(route));
}

/** `modules`: the enabled modules of this process, whose prefixes it serves. */
export function registerContractGuard(
  app: FastifyInstance,
  modules: readonly PlannedModule[],
): void {
  const routes: RuntimeRoute[] = [];
  app.addHook('onRoute', (options) => {
    for (const method of Array.isArray(options.method) ? options.method : [options.method])
      routes.push({ method, url: options.url });
  });
  app.addHook('onReady', () =>
    Promise.resolve().then(() => {
      assertRouteInventory(moduleRoutes(routes, modules), apiOperations, exclusions);
    }),
  );
}
