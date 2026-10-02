import { DiscoveryApi } from './discovery-api.js';
import { UpdatesApi } from './updates-api.js';
import { IdentityApi } from './identity-api.js';
import { UsersApi } from './users-api.js';
import { ServiceAccountsApi } from './service-accounts-api.js';
import { CredentialsApi } from './credentials-api.js';
import { CatalogApi } from './catalog-api.js';
import { AssetsApi } from './assets-api.js';
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
export class ArkvoryClient {
  private readonly discovery: DiscoveryApi;
  private readonly authentication: IdentityApi;
  private readonly usersApi: UsersApi;
  private readonly services: ServiceAccountsApi;
  private readonly credentials: CredentialsApi;
  private readonly catalog: CatalogApi;
  private readonly assets: AssetsApi;
  private readonly storage: StorageApi;
  private readonly uploads: UploadsApi;
  private readonly uploader: UploadTransfer;
  private readonly downloads: DownloadApi;
  readonly identity: IdentityClient;
  readonly administration: AdministrationClient;
  readonly updates: UpdatesApi;
  /** Stages, promotion between repositories and version resolution. */
  readonly promotions: PromotionsApi;
  /** Instance backups: status, plan, jobs, points; system permissions backup.read/manage. */
  readonly backup: BackupApi;
  constructor(baseUrl: string, token: () => string, policy: ClientOptions = {}) {
    const normalized = transferPolicy(policy);
    const http = new HttpTransport(baseUrl, token, policy);
    this.updates = new UpdatesApi(http);
    this.promotions = new PromotionsApi(http);
    this.backup = new BackupApi(http);
    this.discovery = new DiscoveryApi(http);
    this.authentication = new IdentityApi(http);
    this.usersApi = new UsersApi(http);
    this.services = new ServiceAccountsApi(http);
    this.credentials = new CredentialsApi(http);
    this.catalog = new CatalogApi(http);
    this.assets = new AssetsApi(http);
    this.storage = new StorageApi(http);
    this.uploads = new UploadsApi(http, normalized);
    // Narrow facade ports preserve overrides of status/parts/complete/artifact in transfer workflows.
    this.uploader = new UploadTransfer(http, normalized, this);
    this.downloads = new DownloadApi(http, normalized, this);
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
  login(...args: Parameters<IdentityApi['login']>) {
    return this.authentication.login(...args);
  }
  register(...args: Parameters<IdentityApi['register']>) {
    return this.authentication.register(...args);
  }
  permissions(...args: Parameters<IdentityApi['permissions']>) {
    return this.authentication.permissions(...args);
  }
  activateServiceKey(...args: Parameters<IdentityApi['activateServiceKey']>) {
    return this.authentication.activateServiceKey(...args);
  }
  me(...args: Parameters<IdentityApi['me']>) {
    return this.authentication.me(...args);
  }
  logout(...args: Parameters<IdentityApi['logout']>) {
    return this.authentication.logout(...args);
  }
  changePassword(...args: Parameters<IdentityApi['changePassword']>) {
    return this.authentication.changePassword(...args);
  }
  tokens(...args: Parameters<IdentityApi['tokens']>) {
    return this.authentication.tokens(...args);
  }
  createToken(...args: Parameters<IdentityApi['createToken']>) {
    return this.authentication.createToken(...args);
  }
  revokeToken(...args: Parameters<IdentityApi['revokeToken']>) {
    return this.authentication.revokeToken(...args);
  }
  authOptions(...args: Parameters<IdentityApi['authOptions']>) {
    return this.authentication.authOptions(...args);
  }
  accountTokens(...args: Parameters<UsersApi['accountTokens']>) {
    return this.usersApi.accountTokens(...args);
  }
  revokeAccountToken(...args: Parameters<UsersApi['revokeAccountToken']>) {
    return this.usersApi.revokeAccountToken(...args);
  }
  securityAudit(...args: Parameters<UsersApi['securityAudit']>) {
    return this.usersApi.securityAudit(...args);
  }
  users(...args: Parameters<UsersApi['users']>) {
    return this.usersApi.users(...args);
  }
  createUser(...args: Parameters<UsersApi['createUser']>) {
    return this.usersApi.createUser(...args);
  }
  updateUser(...args: Parameters<UsersApi['updateUser']>) {
    return this.usersApi.updateUser(...args);
  }
  accessGroups(...args: Parameters<UsersApi['accessGroups']>) {
    return this.usersApi.accessGroups(...args);
  }
  createAccessGroup(...args: Parameters<UsersApi['createAccessGroup']>) {
    return this.usersApi.createAccessGroup(...args);
  }
  setGroupMember(...args: Parameters<UsersApi['setGroupMember']>) {
    return this.usersApi.setGroupMember(...args);
  }
  setGroupGrant(...args: Parameters<UsersApi['setGroupGrant']>) {
    return this.usersApi.setGroupGrant(...args);
  }
  serviceAccounts(...args: Parameters<ServiceAccountsApi['serviceAccounts']>) {
    return this.services.serviceAccounts(...args);
  }
  servicePolicy(...args: Parameters<ServiceAccountsApi['servicePolicy']>) {
    return this.services.servicePolicy(...args);
  }
  serviceAccount(...args: Parameters<ServiceAccountsApi['serviceAccount']>) {
    return this.services.serviceAccount(...args);
  }
  createServiceAccount(...args: Parameters<ServiceAccountsApi['createServiceAccount']>) {
    return this.services.createServiceAccount(...args);
  }
  updateServiceAccount(...args: Parameters<ServiceAccountsApi['updateServiceAccount']>) {
    return this.services.updateServiceAccount(...args);
  }
  setServicePolicy(...args: Parameters<ServiceAccountsApi['setServicePolicy']>) {
    return this.services.setServicePolicy(...args);
  }
  serviceKeys(...args: Parameters<ServiceAccountsApi['serviceKeys']>) {
    return this.services.serviceKeys(...args);
  }
  serviceAudit(...args: Parameters<ServiceAccountsApi['serviceAudit']>) {
    return this.services.serviceAudit(...args);
  }
  serviceDelegations(...args: Parameters<CredentialsApi['serviceDelegations']>) {
    return this.credentials.serviceDelegations(...args);
  }
  setServiceDelegation(...args: Parameters<CredentialsApi['setServiceDelegation']>) {
    return this.credentials.setServiceDelegation(...args);
  }
  removeServiceDelegation(...args: Parameters<CredentialsApi['removeServiceDelegation']>) {
    return this.credentials.removeServiceDelegation(...args);
  }
  serviceKey(...args: Parameters<CredentialsApi['serviceKey']>) {
    return this.credentials.serviceKey(...args);
  }
  issueServiceKey(...args: Parameters<CredentialsApi['issueServiceKey']>) {
    return this.credentials.issueServiceKey(...args);
  }
  rotateServiceKey(...args: Parameters<CredentialsApi['rotateServiceKey']>) {
    return this.credentials.rotateServiceKey(...args);
  }
  revokeServiceKey(...args: Parameters<CredentialsApi['revokeServiceKey']>) {
    return this.credentials.revokeServiceKey(...args);
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
  downloadVerified(...args: Parameters<DownloadApi['downloadVerified']>) {
    return this.downloads.downloadVerified(...args);
  }
}
