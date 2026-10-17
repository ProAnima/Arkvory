import { randomUUID } from 'node:crypto';
import {
  StorageService,
  ArtifactCatalog,
  GlobalSearch,
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
  MirrorStatus,
  DownloadLinks,
  EventFeed,
  PlacementControl,
  PolicyPlacement,
} from '@proanima/arkvory-application';
import type { MirrorConfiguration } from '@proanima/arkvory-application';
import {
  PostgresIdentity,
  PostgresSecurityAudit,
  PostgresServices,
  PostgresStoragePolicy,
  PostgresBrowse,
  PostgresGlobalSearch,
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
  PostgresMirrorConflicts,
  PostgresMirrorState,
  PostgresWebhookState,
  PostgresTransferLinks,
  PostgresEventLog,
  PostgresPlacementPolicies,
} from '@proanima/arkvory-infrastructure';
import { AuthThrottle } from './auth-throttle.js';
import { BackupMetrics } from './backup-metrics.js';
import { MirrorMetrics } from './mirror-metrics.js';
import { WebhookMetrics } from './webhook-metrics.js';
import { EventMetrics } from './event-metrics.js';
import { StorageMetrics } from './storage-metrics.js';
import { createProtocolServices } from './protocol-services.js';
import type {
  PostgresCatalog,
  PostgresContentPins,
  StagingArea,
  StorageBackends,
} from '@proanima/arkvory-infrastructure';

/** Composition only: each registrar receives just the services it consumes. */
export function createApiServices(
  catalog: PostgresCatalog,
  blobs: StorageBackends,
  pins: PostgresContentPins,
  options: {
    /** Temporary files of raw and OCI uploads on the data volume (ADR 0083, N9). */
    staging: StagingArea;
    allowRegistration?: boolean;
    maxObjectBytes?: number;
    mirrors?: readonly MirrorConfiguration[];
  },
) {
  const { allowRegistration = false, maxObjectBytes, staging } = options;
  const now = () => new Date().toISOString();
  const placements = new PostgresPlacementPolicies(catalog.pool);
  const storageMetrics = new StorageMetrics(blobs);
  const service = new StorageService(
    catalog,
    blobs,
    { next: randomUUID, now },
    {
      placement: new PolicyPlacement(placements, blobs, (decision) => {
        storageMetrics.fellBack(decision);
      }),
      ...(maxObjectBytes === undefined ? {} : { maxObjectBytes }),
    },
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
  const events = new PostgresEventLog(catalog.pool);
  const mirrors = new MirrorStatus(
    options.mirrors ?? [],
    new PostgresMirrorState(catalog.pool),
    new PostgresMirrorConflicts(catalog.pool),
  );
  return {
    jobs,
    mirrors,
    events: new EventFeed(events),
    metricSources: {
      jobs,
      backup: new BackupMetrics(backupStatus, () => performance.now()),
      // No rows without a webhooks file, so an installation without webhooks has no samples.
      webhooks: new WebhookMetrics(new PostgresWebhookState(catalog.pool), () => performance.now()),
      events: new EventMetrics(events, () => performance.now()),
      storage: storageMetrics,
      // Only an installation with mirrors exposes mirror gauges.
      ...((options.mirrors ?? []).length > 0
        ? { mirrors: new MirrorMetrics(mirrors, () => performance.now()) }
        : {}),
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
    placement: new PlacementControl(placements, blobs),
    storageMetrics,
    browse,
    search: new GlobalSearch(new PostgresGlobalSearch(catalog.pool)),
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
    links: new DownloadLinks(service, new PostgresTransferLinks(catalog.pool)),
    ...createProtocolServices(service, browse, catalog, staging, now),
    completion: new CompletionQueue(jobs, randomUUID),
  };
}
