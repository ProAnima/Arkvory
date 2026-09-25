import type { FastifyInstance } from 'fastify';
import type { DiagnosticLogger } from '@proanima/depot-infrastructure';
import type { createApiServices } from './api-services.js';
import type { RequestContext } from './request-context.js';
import type { TransferControls } from './transfer-controls.js';
import type { resolveUploadTimeouts } from './upload-policy.js';
import { createUploadAdmission } from './upload-admission.js';
import { createContentSender, registerDownloadRoutes } from './download-routes.js';
import { registerArtifactRoutes } from './artifact-routes.js';
import { registerOperationRoutes } from './operation-routes.js';
import { registerIdentityRoutes } from './identity-routes.js';
import { registerServiceRoutes } from './service-routes.js';
import { registerRepositoryRoutes } from './repository-routes.js';
import { registerStoragePolicyRoutes } from './storage-policy-routes.js';
import { registerCleanupRoutes } from './cleanup-routes.js';
import { registerRetentionRoutes } from './retention-routes.js';
import { registerAttachmentRoutes } from './attachment-routes.js';
import { registerUploadRoutes } from './upload-routes.js';
import { registerCatalogRoutes } from './catalog-routes.js';

interface Composition {
  services: ReturnType<typeof createApiServices>;
  context: RequestContext;
  transfers: TransferControls;
  available: () => boolean;
  role: 'api' | 'reader';
  policy: ReturnType<typeof resolveUploadTimeouts>;
  diagnostics: Pick<DiagnosticLogger, 'write'>;
}

/** Explicit HTTP wiring; the complete composition is never passed into a route handler. */
export function registerApiRoutes(app: FastifyInstance, dependencies: Composition) {
  const { services: s, context, transfers, available, role, policy, diagnostics } = dependencies;
  const { principal, signal } = context;
  const modifying = createUploadAdmission(transfers.uploadGate, context, available);
  registerOperationRoutes(app, s.access, principal, role);
  registerIdentityRoutes(app, s.identity, principal, transfers.loginGate, signal);
  registerServiceRoutes(app, s.access, principal, role);
  registerRepositoryRoutes(app, principal);
  registerArtifactRoutes(app, s.service, principal);
  registerDownloadRoutes(
    app,
    s.legacy,
    principal,
    createContentSender({
      service: s.service,
      downloadGate: transfers.downloadGate,
      downloadBandwidth: transfers.downloadBandwidth,
      principal,
      signal,
      diagnostics,
      pins: s.pins,
    }),
  );
  registerStoragePolicyRoutes(app, s.storage, s.storagePolicies, principal);
  registerCleanupRoutes(app, s.cleanup, principal);
  registerRetentionRoutes(app, s.retention, principal);
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
}
