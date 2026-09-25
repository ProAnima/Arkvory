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
} from '@proanima/depot-application';
import {
  PostgresIdentity,
  PostgresServices,
  PostgresStoragePolicy,
  PostgresBrowse,
  ZipManifestReader,
  PostgresJobs,
  PostgresRetention,
  PostgresAttachments,
} from '@proanima/depot-infrastructure';
import type { LocalBlobStore, PostgresCatalog } from '@proanima/depot-infrastructure';
import { ProGetDownloads } from '@proanima/depot-proget-compat';

/** Composition only: each registrar receives just the services it consumes. */
export function createApiServices(catalog: PostgresCatalog, blobs: LocalBlobStore) {
  const now = () => new Date().toISOString();
  const service = new StorageService(catalog, blobs, { next: randomUUID, now });
  const serviceAccounts = new PostgresServices(catalog.pool);
  const storagePolicies = new PostgresStoragePolicy(catalog.pool);
  const browse = new ArtifactCatalog(
    service,
    new PostgresBrowse(catalog.pool),
    new ZipManifestReader(blobs),
  );
  return {
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
