import type { FastifyInstance } from 'fastify';
import type { createApiServices } from './api-services.js';
import type { ProtocolTransfers } from './protocol-transfers.js';
import { registerRawRoutes } from './raw-routes.js';
import { registerLfsRoutes } from './lfs-routes.js';
import { registerNpmRoutes } from './npm-routes.js';
import { registerOciRoutes } from './oci-routes.js';

type Services = Pick<
  ReturnType<typeof createApiServices>,
  'raw' | 'browse' | 'lfs' | 'npm' | 'registry'
>;

/**
 * Raw files (ADR 0064) and the protocols beside /api/v1: Git LFS, npm and the image registry
 * (ADR 0065, 0066, 0063). Each keeps its own scope, parsers and error documents.
 */
export function registerProtocolRoutes(
  app: FastifyInstance,
  s: Services,
  t: ProtocolTransfers & { readonly role: 'api' | 'reader' },
) {
  registerRawRoutes(app, { raw: s.raw, browse: s.browse, ...t });
  registerLfsRoutes(app, { lfs: s.lfs, ...t });
  registerNpmRoutes(app, { npm: s.npm, ...t });
  registerOciRoutes(app, { registry: s.registry, ...t });
}
