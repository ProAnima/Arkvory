import { DiscoveryApi } from './discovery-api.js';
import { UpdatesApi } from './updates-api.js';
import { ReplicationApi } from './replication-api.js';
import { FeedbackApi } from './feedback-api.js';
import { AccountClient } from './account-client.js';
import { CatalogApi } from './catalog-api.js';
import { AssetsApi } from './assets-api.js';
import { RawApi } from './raw-api.js';
import { StorageApi } from './storage-api.js';
import { UploadsApi } from './uploads-api.js';
import { UploadTransfer } from './upload-transfer.js';
import { DownloadApi } from './download-api.js';
import { PromotionsApi } from './promotions-api.js';
import { BackupApi } from './backup-api.js';
import { HttpTransport } from './http-transport.js';
import type { RequestEvent } from './http-transport.js';
import { transferPolicy } from './transfer.js';
import type { TransferPolicy } from './transfer.js';
import { managementClients } from './management-client.js';
import type { IdentityClient, AdministrationClient } from './management-client.js';
import { repositoryClient } from './repository-client.js';
import type { RepositoryClient } from './repository-client.js';

export interface ClientOptions extends TransferPolicy {
  /** Cancels all requests of this client, including management operations. */
  readonly signal?: AbortSignal;
  /** Fallback request/body deadline when no per-operation signal is supplied.
   * Explicit signals own their deadlines; transfer attempts retain their own deadlines.
   */
  readonly requestTimeoutMs?: number;
  /**
   * Called once per HTTP exchange with method, path, status, duration and request ID only
   * (ADR 0051); for diagnostics such as a CLI --verbose mode. Never receives credentials.
   */
  readonly onRequest?: (event: RequestEvent) => void;
}

/** Compatible public facade. Each operation delegates to its responsible API module. */
export class ArkvoryClient extends AccountClient {
  private readonly discovery: DiscoveryApi;
  private readonly catalog: CatalogApi;
  private readonly assets: AssetsApi;
  /** Raw files by path in one request (ADR 0064); resumable uploads stay create/resume. */
  readonly raw: RawApi;
  private readonly storage: StorageApi;
  private readonly uploads: UploadsApi;
  private readonly uploader: UploadTransfer;
  private readonly downloads: DownloadApi;
  readonly identity: IdentityClient;
  readonly administration: AdministrationClient;
  readonly updates: UpdatesApi;
  /** Copies of an HA cluster from readiness (ADR 0072); standalone servers have none. */
  readonly replication: ReplicationApi;
  /** Stages, promotion between repositories and version resolution. */
  readonly promotions: PromotionsApi;
  /** Instance backups: status, plan, jobs, points; system permissions backup.read/manage. */
  readonly backup: BackupApi;
  /** Feedback with screenshots and logs to ProAnimaStudio, through this server. */
  readonly feedback: FeedbackApi;
  constructor(baseUrl: string, token: () => string, policy: ClientOptions = {}) {
    const normalized = transferPolicy(policy);
    const http = new HttpTransport(baseUrl, token, policy);
    super(http);
    this.updates = new UpdatesApi(http);
    this.replication = new ReplicationApi(http);
    this.promotions = new PromotionsApi(http);
    this.backup = new BackupApi(http);
    this.feedback = new FeedbackApi(http);
    this.discovery = new DiscoveryApi(http);
    this.catalog = new CatalogApi(http);
    this.assets = new AssetsApi(http);
    this.raw = new RawApi(http);
    this.storage = new StorageApi(http);
    this.uploads = new UploadsApi(http, normalized);
    // Narrow facade ports preserve overrides of status/parts/complete/artifact in transfer workflows.
    this.uploader = new UploadTransfer(http, normalized, this);
    this.downloads = new DownloadApi(http, normalized, this, (path) => http.href(path));
    const namespaces = managementClients(this);
    this.identity = namespaces.identity;
    this.administration = namespaces.administration;
  }
  inRepository(repository: string): RepositoryClient {
    return repositoryClient(this, repository);
  }
  operations(...args: Parameters<DiscoveryApi['operations']>) {
    return this.discovery.operations(...args);
  }
  capabilities(...args: Parameters<DiscoveryApi['capabilities']>) {
    return this.discovery.capabilities(...args);
  }
  repositories(...args: Parameters<DiscoveryApi['repositories']>) {
    return this.discovery.repositories(...args);
  }
  repository(...args: Parameters<DiscoveryApi['repository']>) {
    return this.discovery.repository(...args);
  }
  packages(...args: Parameters<CatalogApi['packages']>) {
    return this.catalog.packages(...args);
  }
  artifact(...args: Parameters<CatalogApi['artifact']>) {
    return this.catalog.artifact(...args);
  }
  list(...args: Parameters<CatalogApi['list']>) {
    return this.catalog.list(...args);
  }
  search(...args: Parameters<CatalogApi['search']>) {
    return this.catalog.search(...args);
  }
  attachments(...args: Parameters<CatalogApi['attachments']>) {
    return this.catalog.attachments(...args);
  }
  replaceAttachments(...args: Parameters<CatalogApi['replaceAttachments']>) {
    return this.catalog.replaceAttachments(...args);
  }
  attachmentHistory(...args: Parameters<CatalogApi['attachmentHistory']>) {
    return this.catalog.attachmentHistory(...args);
  }
  annotations(...args: Parameters<CatalogApi['annotations']>) {
    return this.catalog.annotations(...args);
  }
  annotate(...args: Parameters<CatalogApi['annotate']>) {
    return this.catalog.annotate(...args);
  }
  registerPackage(...args: Parameters<CatalogApi['registerPackage']>) {
    return this.catalog.registerPackage(...args);
  }
  catalogChanges(...args: Parameters<CatalogApi['changes']>) {
    return this.catalog.changes(...args);
  }
  repositoryMirror(...args: Parameters<CatalogApi['mirror']>) {
    return this.catalog.mirror(...args);
  }
  setAsset(...args: Parameters<AssetsApi['setAsset']>) {
    return this.assets.setAsset(...args);
  }
  asset(...args: Parameters<AssetsApi['asset']>) {
    return this.assets.asset(...args);
  }
  assetPage(...args: Parameters<AssetsApi['assetPage']>) {
    return this.assets.assetPage(...args);
  }
  assetHistory(...args: Parameters<AssetsApi['assetHistory']>) {
    return this.assets.assetHistory(...args);
  }
  assetRevision(...args: Parameters<AssetsApi['assetRevision']>) {
    return this.assets.assetRevision(...args);
  }
  restoreAsset(...args: Parameters<AssetsApi['restoreAsset']>) {
    return this.assets.restoreAsset(...args);
  }
  inspectDeletion(...args: Parameters<StorageApi['inspectDeletion']>) {
    return this.storage.inspectDeletion(...args);
  }
  deleteArtifact(...args: Parameters<StorageApi['deleteArtifact']>) {
    return this.storage.deleteArtifact(...args);
  }
  storagePolicy(...args: Parameters<StorageApi['storagePolicy']>) {
    return this.storage.storagePolicy(...args);
  }
  cleanup(...args: Parameters<StorageApi['cleanup']>) {
    return this.storage.cleanup(...args);
  }
  configureCleanup(...args: Parameters<StorageApi['configureCleanup']>) {
    return this.storage.configureCleanup(...args);
  }
  requestCleanup(...args: Parameters<StorageApi['requestCleanup']>) {
    return this.storage.requestCleanup(...args);
  }
  setStoragePolicy(...args: Parameters<StorageApi['setStoragePolicy']>) {
    return this.storage.setStoragePolicy(...args);
  }
  storageUsage(...args: Parameters<StorageApi['storageUsage']>) {
    return this.storage.storageUsage(...args);
  }
  previewStoragePolicy(...args: Parameters<StorageApi['previewStoragePolicy']>) {
    return this.storage.previewStoragePolicy(...args);
  }
  runStoragePolicy(...args: Parameters<StorageApi['runStoragePolicy']>) {
    return this.storage.runStoragePolicy(...args);
  }
  storageEvents(...args: Parameters<StorageApi['storageEvents']>) {
    return this.storage.storageEvents(...args);
  }
  previewRetention(...args: Parameters<StorageApi['previewRetention']>) {
    return this.storage.previewRetention(...args);
  }
  applyRetention(...args: Parameters<StorageApi['applyRetention']>) {
    return this.storage.applyRetention(...args);
  }
  create(...args: Parameters<UploadsApi['create']>) {
    return this.uploads.create(...args);
  }
  status(...args: Parameters<UploadsApi['status']>) {
    return this.uploads.status(...args);
  }
  parts(...args: Parameters<UploadsApi['parts']>) {
    return this.uploads.parts(...args);
  }
  complete(...args: Parameters<UploadsApi['complete']>) {
    return this.uploads.complete(...args);
  }
  enqueue(...args: Parameters<UploadsApi['enqueue']>) {
    return this.uploads.enqueue(...args);
  }
  job(...args: Parameters<UploadsApi['job']>) {
    return this.uploads.job(...args);
  }
  cancel(...args: Parameters<UploadsApi['cancel']>) {
    return this.uploads.cancel(...args);
  }
  resume(...args: Parameters<UploadTransfer['resume']>) {
    return this.uploader.resume(...args);
  }
  download(...args: Parameters<DownloadApi['download']>) {
    return this.downloads.download(...args);
  }
  createDownloadLink(...args: Parameters<DownloadApi['createDownloadLink']>) {
    return this.downloads.createDownloadLink(...args);
  }
  downloadVerified(...args: Parameters<DownloadApi['downloadVerified']>) {
    return this.downloads.downloadVerified(...args);
  }
}
