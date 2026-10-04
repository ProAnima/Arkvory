import type { FastifyInstance } from 'fastify';
import { apiOperations, assertRouteInventory } from '@proanima/arkvory-contracts';
import type { RuntimeRoute } from '@proanima/arkvory-contracts';
import { registryRoute } from './oci-errors.js';

const lfs = '/lfs/:repository';
const lfsRoutes = [
  ['POST', `${lfs}/objects/batch`],
  ['PUT', `${lfs}/objects/:oid`],
  ['GET', `${lfs}/objects/:oid`],
  ['HEAD', `${lfs}/objects/:oid`],
  ['POST', `${lfs}/locks`],
  ['GET', `${lfs}/locks`],
  ['HEAD', `${lfs}/locks`],
  ['POST', `${lfs}/locks/verify`],
  ['POST', `${lfs}/locks/:id/unlock`],
] as const;

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
// The container registry follows the OCI Distribution specification, not the /api/v1 contract.
const registryMethods = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'];
const exclusions = [
  ...staticPaths.flatMap((url) => ['GET', 'HEAD'].map((method) => ({ method, url }))),
  ...registryMethods.map((method) => ({ method, url: registryRoute })),
  // Git LFS follows the git-lfs batch, transfer and locking APIs (ADR 0065).
  ...lfsRoutes.map(([method, url]) => ({ method, url })),
];
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
