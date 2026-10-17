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
 * (ADR 0065, 0066, 0063). Each keeps its own scope, parsers and error documents. A protocol whose
 * module is disabled (ADR 0079, 5.7) registers nothing: its paths answer 404 `not_found` like any
 * other unknown path, and its tables keep their rows for when it is enabled again.
 */
export function registerProtocolRoutes(
  app: FastifyInstance,
  s: Services,
  enabled: ReadonlySet<string>,
  t: ProtocolTransfers & { readonly role: 'api' | 'reader' },
) {
  // Raw files are part of the free core and never disabled.
  registerRawRoutes(app, { raw: s.raw, browse: s.browse, ...t });
  if (enabled.has('lfs')) registerLfsRoutes(app, { lfs: s.lfs, ...t });
  if (enabled.has('npm')) registerNpmRoutes(app, { npm: s.npm, ...t });
  if (enabled.has('oci')) registerOciRoutes(app, { registry: s.registry, ...t });
}
