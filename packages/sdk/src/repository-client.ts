import type { StorageApi } from './storage-api.js';
import type { DiscoveryApi } from './discovery-api.js';
import type { CatalogApi } from './catalog-api.js';
import type { DownloadApi } from './download-api.js';
import type { UploadsApi } from './uploads-api.js';
import type { UploadTransfer } from './upload-transfer.js';
import type { AssetsApi } from './assets-api.js';
import type { OperationQuery } from '@proanima/depot-contracts';

type RepositoryTransport = Pick<
  StorageApi,
  | 'storagePolicy'
  | 'setStoragePolicy'
  | 'storageUsage'
  | 'previewStoragePolicy'
  | 'runStoragePolicy'
  | 'storageEvents'
  | 'inspectDeletion'
  | 'deleteArtifact'
  | 'previewRetention'
  | 'applyRetention'
> &
  Pick<DiscoveryApi, 'repository' | 'operations'> &
  Pick<
    CatalogApi,
    | 'list'
    | 'search'
    | 'artifact'
    | 'attachments'
    | 'replaceAttachments'
    | 'attachmentHistory'
    | 'annotations'
    | 'annotate'
    | 'packages'
    | 'registerPackage'
  > &
  Pick<DownloadApi, 'download' | 'downloadVerified'> &
  Pick<UploadsApi, 'create' | 'status' | 'parts' | 'complete' | 'enqueue' | 'cancel'> &
  Pick<UploadTransfer, 'resume'> &
  Pick<
    AssetsApi,
    'asset' | 'assetPage' | 'assetHistory' | 'assetRevision' | 'setAsset' | 'restoreAsset'
  >;

/** Ergonomic scope, not a credential or security boundary. Transport/retry behavior stays shared. */
export function repositoryClient(client: RepositoryTransport, repository: string) {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(repository)) throw new Error('Invalid repository');
  const bind =
    <A extends unknown[], R>(method: (repository: string, ...args: A) => R) =>
    (...args: A): R =>
      method.call(client, repository, ...args);
  return Object.freeze({
    id: repository,
    describe: bind(client.repository),
    operations: (query: Omit<OperationQuery, 'repository'> = {}, signal?: AbortSignal) =>
      client.operations({ ...query, repository }, signal),
    artifacts: Object.freeze({
      inspectDeletion: bind(client.inspectDeletion),
      delete: bind(client.deleteArtifact),
      list: bind(client.list),
      search: bind(client.search),
      get: bind(client.artifact),
      download: bind(client.download),
      downloadVerified: bind(client.downloadVerified),
    }),
    attachments: Object.freeze({
      get: bind(client.attachments),
      replace: bind(client.replaceAttachments),
      history: bind(client.attachmentHistory),
    }),
    storage: Object.freeze({
      policy: bind(client.storagePolicy),
      configure: bind(client.setStoragePolicy),
      usage: bind(client.storageUsage),
      preview: bind(client.previewStoragePolicy),
      run: bind(client.runStoragePolicy),
      events: bind(client.storageEvents),
    }),
    retention: Object.freeze({
      preview: bind(client.previewRetention),
      apply: bind(client.applyRetention),
    }),
    annotations: Object.freeze({ get: bind(client.annotations), update: bind(client.annotate) }),
    uploads: Object.freeze({
      create: bind(client.create),
      get: bind(client.status),
      parts: bind(client.parts),
      resume: bind(client.resume),
      complete: bind(client.complete),
      completeAsync: bind(client.enqueue),
      cancel: bind(client.cancel),
    }),
    packages: Object.freeze({
      list: bind(client.packages),
      register: bind(client.registerPackage),
    }),
    assets: Object.freeze({
      get: bind(client.asset),
      list: bind(client.assetPage),
      history: bind(client.assetHistory),
      revision: bind(client.assetRevision),
      assign: bind(client.setAsset),
      restore: bind(client.restoreAsset),
    }),
  });
}
export type RepositoryClient = ReturnType<typeof repositoryClient>;
