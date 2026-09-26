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
} from '@proanima/arkvory-application';
import {
  PostgresIdentity,
  PostgresServices,
  PostgresStoragePolicy,
  PostgresBrowse,
  ZipManifestReader,
  PostgresJobs,
  PostgresRetention,
  PostgresAttachments,
  PostgresCleanupSettings,
  PostgresOnlineCleanup,
} from '@proanima/arkvory-infrastructure';
import type {
  LocalBlobStore,
  PostgresCatalog,
  PostgresContentPins,
} from '@proanima/arkvory-infrastructure';
import { ProGetDownloads } from '@proanima/arkvory-proget-compat';

/** Composition only: each registrar receives just the services it consumes. */
export function createApiServices(
  catalog: PostgresCatalog,
  blobs: LocalBlobStore,
  pins: PostgresContentPins,
) {
  const now = () => new Date().toISOString();
  const service = new StorageService(catalog, blobs, { next: randomUUID, now });
  const serviceAccounts = new PostgresServices(catalog.pool);
  const storagePolicies = new PostgresStoragePolicy(catalog.pool);
  const browse = new ArtifactCatalog(
    service,
    new PostgresBrowse(catalog.pool),
    new ZipManifestReader(blobs, pins),
  );
  return {
    pins,
    cleanup: new RepositoryCleanup(new PostgresCleanupSettings(catalog.pool)),
    collector: new PostgresOnlineCleanup(catalog.pool, blobs),
    service,
    serviceAccounts,
    storagePolicies,
    browse,
    identity: new IdentityService(new PostgresIdentity(catalog.pool)),
    access: new ServiceAccess(serviceAccounts),
    legacy: new ProGetDownloads(browse),
    storage: new RepositoryStorage(storagePolicies),
    retention: new ArtifactRetention(new PostgresRetention(catalog.pool), now),
    attachments: new BuildAttachments(service, new PostgresAttachments(catalog.pool)),
    completion: new CompletionQueue(new PostgresJobs(catalog.pool), randomUUID),
  };
}
