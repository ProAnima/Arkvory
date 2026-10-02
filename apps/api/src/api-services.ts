import { randomUUID } from 'node:crypto';
import {
  StorageService,
  ArtifactCatalog,
  CompletionQueue,
  IdentityService,
  ServiceAccess,
  RepositoryStorage,
  ArtifactRetention,
  BuildAttachments,
  RepositoryCleanup,
  ArtifactPromotion,
  PackageResolver,
  BackupControl,
} from '@proanima/arkvory-application';
import {
  PostgresIdentity,
  PostgresSecurityAudit,
  PostgresServices,
  PostgresStoragePolicy,
  PostgresBrowse,
  ZipManifestReader,
  PostgresJobs,
  PostgresRetention,
  PostgresAttachments,
  PostgresCleanupSettings,
  PostgresOnlineCleanup,
  PostgresStages,
  PostgresPackageCandidates,
  PostgresPromotions,
  PostgresBackupCatalog,
  PostgresBackupPlan,
  PostgresBackupRequests,
  PostgresBackupStatus,
} from '@proanima/arkvory-infrastructure';
import { AuthThrottle } from './auth-throttle.js';
import { BackupMetrics } from './backup-metrics.js';
import type {
  LocalBlobStore,
  PostgresCatalog,
  PostgresContentPins,
} from '@proanima/arkvory-infrastructure';

/** Composition only: each registrar receives just the services it consumes. */
export function createApiServices(
  catalog: PostgresCatalog,
  blobs: LocalBlobStore,
  pins: PostgresContentPins,
  options: { allowRegistration?: boolean; maxObjectBytes?: number } = {},
) {
  const { allowRegistration = false, maxObjectBytes } = options;
  const now = () => new Date().toISOString();
  const service = new StorageService(
    catalog,
    blobs,
    { next: randomUUID, now },
    maxObjectBytes === undefined ? {} : { maxObjectBytes },
  );
  const serviceAccounts = new PostgresServices(catalog.pool);
  const storagePolicies = new PostgresStoragePolicy(catalog.pool);
  const securityAudit = new PostgresSecurityAudit(catalog.pool);
  const browse = new ArtifactCatalog(
    service,
    new PostgresBrowse(catalog.pool),
    new ZipManifestReader(blobs, pins),
  );
  const stages = new PostgresStages(catalog.pool);
  const jobs = new PostgresJobs(catalog.pool);
  const backupStatus = new PostgresBackupStatus(catalog.pool);
  const backupRequests = new PostgresBackupRequests(catalog.pool);
  return {
    jobs,
    metricSources: {
      jobs,
      backup: new BackupMetrics(backupStatus, () => performance.now()),
    },
    backup: new BackupControl({
      status: backupStatus,
      plans: new PostgresBackupPlan(catalog.pool),
      requests: backupRequests,
      jobs: backupRequests,
      catalog: new PostgresBackupCatalog(catalog.pool),
      next: randomUUID,
    }),
    promotion: new ArtifactPromotion(
      service,
      stages,
      new PostgresPromotions(catalog.pool, catalog, blobs),
      { next: randomUUID, now },
    ),
    resolver: new PackageResolver(new PostgresPackageCandidates(catalog.pool), stages),
    pins,
    cleanup: new RepositoryCleanup(new PostgresCleanupSettings(catalog.pool)),
    collector: new PostgresOnlineCleanup(catalog.pool, blobs),
    service,
    serviceAccounts,
    storagePolicies,
    browse,
    securityAudit,
    authThrottle: new AuthThrottle(() => Date.now()),
    identity: new IdentityService(new PostgresIdentity(catalog.pool), {
      allowRegistration,
      now: () => new Date(),
      audit: securityAudit,
    }),
    access: new ServiceAccess(serviceAccounts),
    storage: new RepositoryStorage(storagePolicies),
    retention: new ArtifactRetention(new PostgresRetention(catalog.pool), now),
    attachments: new BuildAttachments(service, new PostgresAttachments(catalog.pool)),
    completion: new CompletionQueue(jobs, randomUUID),
  };
}
