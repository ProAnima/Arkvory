import type { FastifyInstance } from 'fastify';
import { apiOperations, assertRouteInventory } from '@proanima/arkvory-contracts';
import type { RuntimeRoute } from '@proanima/arkvory-contracts';

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
];
const exclusions = staticPaths.flatMap((url) => ['GET', 'HEAD'].map((method) => ({ method, url })));
export function registerContractGuard(app: FastifyInstance): void {
  const routes: RuntimeRoute[] = [];
  app.addHook('onRoute', (options) => {
    for (const method of Array.isArray(options.method) ? options.method : [options.method])
      routes.push({ method, url: options.url });
  });
  app.addHook('onReady', () =>
    Promise.resolve().then(() => {
      assertRouteInventory(routes, apiOperations, exclusions);
    }),
  );
}
