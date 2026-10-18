import type { FastifyInstance } from 'fastify';
import type { DiagnosticLogger } from '@proanima/arkvory-infrastructure';
import type { createApiServices } from './api-services.js';
import type { RequestContext } from './request-context.js';
import type { TransferControls } from './transfer-controls.js';
import type { resolveUploadTimeouts } from './upload-policy.js';
import { createUploadAdmission } from './upload-admission.js';
import { createContentSender, registerDownloadRoutes } from './download-routes.js';
import { createDownloadAdmission } from './download-admission.js';
import { registerArtifactRoutes } from './artifact-routes.js';
import { registerOperationRoutes } from './operation-routes.js';
import { registerIdentityRoutes } from './identity-routes.js';
import { registerServiceRoutes } from './service-routes.js';
import { registerRepositoryRoutes } from './repository-routes.js';
import { registerStoragePolicyRoutes } from './storage-policy-routes.js';
import { registerPlacementRoutes } from './placement-routes.js';
import { registerCleanupRoutes } from './cleanup-routes.js';
import { registerRetentionRoutes } from './retention-routes.js';
import { registerAttachmentRoutes } from './attachment-routes.js';
import { registerUploadRoutes } from './upload-routes.js';
import { registerCatalogRoutes } from './catalog-routes.js';
import { registerGlobalSearchRoute } from './search-routes.js';
import { registerPromotionRoutes } from './promotion-routes.js';
import { registerBackupRoutes } from './backup-routes.js';
import { registerMirrorRoutes } from './mirror-routes.js';
import { registerLinkRoutes } from './link-routes.js';
import { registerProtocolRoutes } from './protocol-routes.js';
import { registerExtensionRoutes } from './extension-routes.js';
import type { ModuleRouteSet } from './extension-registry.js';

interface Composition {
  services: ReturnType<typeof createApiServices>;
  context: RequestContext;
  transfers: TransferControls;
  available: () => boolean;
  role: 'api' | 'reader';
  policy: ReturnType<typeof resolveUploadTimeouts>;
  diagnostics: Pick<DiagnosticLogger, 'write'>;
  /** Enabled modules of this process (ADR 0079): their routes and `capabilities.modules`. */
  modules: readonly { readonly id: string; readonly kind: string }[];
  /** Routes and transfer offers of running modules (ADR 0083, N7; ADR 0079, 5.2). */
  extensions: readonly ModuleRouteSet[];
}

/** Explicit HTTP wiring; the complete composition is never passed into a route handler. */
export function registerApiRoutes(app: FastifyInstance, dependencies: Composition) {
  const {
    services: s,
    context,
    transfers,
    available,
    role,
    policy,
    diagnostics,
    modules,
    extensions,
  } = dependencies;
  const { principal, signal } = context;
  const modifying = createUploadAdmission(transfers.uploadGate, context, available);
  registerOperationRoutes(app, s.access, principal, role);
  registerIdentityRoutes(app, {
    service: s.identity,
    principal,
    signal,
    anonymousGate: transfers.loginGate,
    accountGate: transfers.accountGate,
    throttle: s.authThrottle,
  });
  registerServiceRoutes(app, s.access, principal, role, {
    maxObjectBytes: s.service.maxObjectBytes,
    selfRegistration: s.identity.allowRegistration,
    modules,
    transfer: extensions.flatMap((set) => set.offers),
  });
  registerRepositoryRoutes(app, principal);
  registerArtifactRoutes(app, s.service, principal);
  registerLinkRoutes(app, s.links, principal);
  const sendContent = createContentSender({
    service: s.service,
    admit: createDownloadAdmission(transfers),
    downloadBandwidth: transfers.downloadBandwidth,
    principal,
    signal,
    diagnostics,
    pins: s.pins,
  });
  registerDownloadRoutes(app, { resolver: s.resolver, browse: s.browse }, principal, sendContent);
  registerProtocolRoutes(app, s, new Set(modules.map((m) => m.id)), {
    principal,
    signal,
    context,
    modifying,
    sendContent,
    bandwidth: transfers.uploadBandwidth,
    policy,
    diagnostics,
    role,
  });
  registerExtensionRoutes(
    app,
    extensions.flatMap((set) => set.routes),
    {
      principal,
      signal,
      context,
      modifying,
      sendContent,
      bandwidth: transfers.uploadBandwidth,
      policy,
      diagnostics,
      role,
      downloadGate: transfers.downloadGate,
      downloadBandwidth: transfers.downloadBandwidth,
      maxObjectBytes: s.service.maxObjectBytes,
    },
  );
  registerStoragePolicyRoutes(app, s.storage, s.storagePolicies, principal);
  registerCleanupRoutes(app, s.cleanup, principal);
  registerPlacementRoutes(app, s.placement, principal);
  registerRetentionRoutes(app, s.retention, principal);
  registerBackupRoutes(app, s.backup, principal);
  registerMirrorRoutes(app, s.mirrors, principal);
  registerAttachmentRoutes(app, s.attachments, principal);
  registerUploadRoutes(app, {
    storage: s.service,
    queue: s.completion,
    principal,
    signal,
    modifying,
    bandwidth: transfers.uploadBandwidth,
    policy,
    diagnostics,
  });
  registerCatalogRoutes(app, { browse: s.browse, principal, modifying });
  registerGlobalSearchRoute(app, s.search, principal);
  registerPromotionRoutes(app, {
    promotion: s.promotion,
    resolver: s.resolver,
    principal,
    modifying,
  });
}
