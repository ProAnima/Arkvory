// Public flat SDK contract before decomposition (81703c5); update only for reviewed API changes.
import type { StoragePolicyRequest } from '@proanima/arkvory-contracts';
import type {
  RetentionPreviewRequest,
  RetentionApplyRequest,
  BuildAttachmentResponse,
  UploadResponse,
  AnnotationsResponse,
  ServiceBindingResponse,
  AdministrationPermission,
  OperationQuery,
} from '@proanima/arkvory-contracts';
import type { TransferOptions, TransferPolicy } from '@proanima/arkvory-sdk';
export interface LegacyConstructor {
  new (baseUrl: string, token: () => string, policy?: TransferPolicy): LegacyClient;
}
export interface LegacyClient {
  inspectDeletion(
    repository: string,
    id: string,
    signal?: AbortSignal,
  ): Promise<{
    id: string;
    name: string;
    size: string;
    publishedAt: string;
    annotationRevision: number;
    blockers: ('reference' | 'asset_history' | 'attachment_history' | 'protected_label')[];
  }>;
  deleteArtifact(
    repository: string,
    id: string,
    expectedAnnotationRevision: number,
    signal?: AbortSignal,
  ): Promise<{
    id: string;
    outcome: 'not_found' | 'deleted' | 'already_deleted' | 'protected' | 'changed' | 'not_eligible';
    blockers: ('reference' | 'asset_history' | 'attachment_history' | 'protected_label')[];
  }>;
  storagePolicy(
    repository: string,
    signal?: AbortSignal,
  ): Promise<{
    revision: number;
    policy: {
      enabled: boolean;
      grouping: 'repository' | 'package-channel' | 'package';
      keepLast: number;
      channels: {
        label: string;
        keepLast: number;
      }[];
      protectedLabels: string[];
      minAgeHours: number;
      intervalMinutes: number;
      quotaBytes: string | null;
      warningPercent: number;
      criticalPercent: number;
    };
    nextRunAt: string | null;
    lastRunAt: string | null;
    lastDeleted: number;
    lastError: string | null;
  }>;
  setStoragePolicy(
    repository: string,
    expectedRevision: number,
    policy: StoragePolicyRequest,
    signal?: AbortSignal,
  ): Promise<{
    revision: number;
    policy: {
      enabled: boolean;
      grouping: 'repository' | 'package-channel' | 'package';
      keepLast: number;
      channels: {
        label: string;
        keepLast: number;
      }[];
      protectedLabels: string[];
      minAgeHours: number;
      intervalMinutes: number;
      quotaBytes: string | null;
      warningPercent: number;
      criticalPercent: number;
    };
    nextRunAt: string | null;
    lastRunAt: string | null;
    lastDeleted: number;
    lastError: string | null;
  }>;
  storageUsage(
    repository: string,
    signal?: AbortSignal,
  ): Promise<{
    publishedBytes: string;
    pendingBytes: string;
    retiredBytes: string;
    reservedBytes: string;
    quotaBytes: string | null;
    state: 'unlimited' | 'normal' | 'warning' | 'critical' | 'exceeded';
  }>;
  previewStoragePolicy(
    repository: string,
    signal?: AbortSignal,
  ): Promise<{
    revision: number;
    items: {
      id: string;
      name: string;
      size: string;
      publishedAt: string;
      annotationRevision: number;
      blockers: ('reference' | 'asset_history' | 'attachment_history' | 'protected_label')[];
    }[];
    hasMore: boolean;
  }>;
  runStoragePolicy(
    repository: string,
    expectedRevision: number,
    signal?: AbortSignal,
  ): Promise<{
    items: {
      id: string;
      outcome:
        'not_found' | 'deleted' | 'already_deleted' | 'protected' | 'changed' | 'not_eligible';
      blockers: ('reference' | 'asset_history' | 'attachment_history' | 'protected_label')[];
    }[];
  }>;
  storageEvents(
    repository: string,
    options?: {
      after?: string;
      level?: 'info' | 'warning' | 'error';
    },
    signal?: AbortSignal,
  ): Promise<{
    items: {
      sequence: string;
      occurredAt: string;
      level: 'warning' | 'info' | 'error';
      code: string;
      details: Record<string, string | number>;
    }[];
    next: string | null;
  }>;
  previewRetention(
    repository: string,
    input: RetentionPreviewRequest,
    signal?: AbortSignal,
  ): Promise<{
    items: {
      id: string;
      name: string;
      size: string;
      publishedAt: string;
      annotationRevision: number;
      blockers: ('reference' | 'asset_history' | 'attachment_history' | 'protected_label')[];
    }[];
    next: string | null;
  }>;
  applyRetention(
    repository: string,
    input: RetentionApplyRequest,
    signal?: AbortSignal,
  ): Promise<{
    items: {
      id: string;
      outcome:
        'not_found' | 'deleted' | 'already_deleted' | 'protected' | 'changed' | 'not_eligible';
      blockers: ('reference' | 'asset_history' | 'attachment_history' | 'protected_label')[];
    }[];
  }>;
  operations(
    query?: OperationQuery,
    signal?: AbortSignal,
  ): Promise<import('@proanima/arkvory-contracts').OperationPage>;
  login(
    name: string,
    password: string,
  ): Promise<import('@proanima/arkvory-contracts').LoginResponse>;
  capabilities(signal?: AbortSignal): Promise<{
    apiVersions: string[];
    gatewayRole: string;
    features: {
      [k: string]: boolean;
    };
    limits: {
      maxObjectBytes: string;
      partBytes: number;
      maxPageSize: number;
    };
  }>;
  permissions(signal?: AbortSignal): Promise<{
    id: string;
    profile: string;
    bindings: readonly ServiceBindingResponse[];
    serviceAdministration: boolean;
    credentialId: string | null;
  }>;
  repositories(
    options?: {
      after?: string;
      limit?: number;
    },
    signal?: AbortSignal,
  ): Promise<{
    items: {
      id: string;
      formats: readonly ['upack', 'assets'];
      permissions: (
        | 'repository.read'
        | 'storage.read'
        | 'storage.manage'
        | 'diagnostics.read'
        | 'artifact.read'
        | 'artifact.list'
        | 'artifact.delete'
        | 'content.read'
        | 'upload.create'
        | 'upload.read'
        | 'upload.write'
        | 'upload.complete'
        | 'upload.cancel'
        | 'job.read'
        | 'package.read'
        | 'package.publish'
        | 'asset.read'
        | 'asset.write'
        | 'asset.restore'
        | 'annotation.read'
        | 'annotation.write'
        | 'reference.write'
        | 'audit.read'
      )[];
    }[];
    next: string | null;
  }>;
  repository(
    id: string,
    signal?: AbortSignal,
  ): Promise<{
    id: string;
    formats: readonly ['upack', 'assets'];
    permissions: (
      | 'repository.read'
      | 'storage.read'
      | 'storage.manage'
      | 'diagnostics.read'
      | 'artifact.read'
      | 'artifact.list'
      | 'artifact.delete'
      | 'content.read'
      | 'upload.create'
      | 'upload.read'
      | 'upload.write'
      | 'upload.complete'
      | 'upload.cancel'
      | 'job.read'
      | 'package.read'
      | 'package.publish'
      | 'asset.read'
      | 'asset.write'
      | 'asset.restore'
      | 'annotation.read'
      | 'annotation.write'
      | 'reference.write'
      | 'audit.read'
    )[];
  }>;
  serviceAccounts(
    after?: string,
    signal?: AbortSignal,
  ): Promise<{
    items: import('@proanima/arkvory-contracts').ServiceAccountResponse[];
    next: string | null;
  }>;
  serviceDelegations(
    keyId: string,
    signal?: AbortSignal,
  ): Promise<
    {
      keyId: string;
      targetAccountId: string;
      enabled: boolean;
      revision: number;
      actions: (
        | 'service-account.read'
        | 'service-account.manage'
        | 'policy.read'
        | 'policy.manage'
        | 'credential.read'
        | 'credential.manage'
        | 'service-audit.read'
      )[];
      ceiling: readonly ServiceBindingResponse[];
    }[]
  >;
  servicePolicy(
    accountId: string,
    signal?: AbortSignal,
  ): Promise<import('@proanima/arkvory-contracts').ServiceAccountResponse>;
  setServiceDelegation(
    keyId: string,
    accountId: string,
    expectedRevision: number,
    actions: readonly AdministrationPermission[],
    ceiling: readonly ServiceBindingResponse[],
    signal?: AbortSignal,
  ): Promise<{
    keyId: string;
    targetAccountId: string;
    enabled: boolean;
    revision: number;
    actions: (
      | 'service-account.read'
      | 'service-account.manage'
      | 'policy.read'
      | 'policy.manage'
      | 'credential.read'
      | 'credential.manage'
      | 'service-audit.read'
    )[];
    ceiling: readonly ServiceBindingResponse[];
  }>;
  removeServiceDelegation(
    keyId: string,
    accountId: string,
    expectedRevision: number,
    signal?: AbortSignal,
  ): Promise<{
    keyId: string;
    targetAccountId: string;
    enabled: boolean;
    revision: number;
    actions: (
      | 'service-account.read'
      | 'service-account.manage'
      | 'policy.read'
      | 'policy.manage'
      | 'credential.read'
      | 'credential.manage'
      | 'service-audit.read'
    )[];
    ceiling: readonly ServiceBindingResponse[];
  }>;
  serviceAccount(
    id: string,
    signal?: AbortSignal,
  ): Promise<import('@proanima/arkvory-contracts').ServiceAccountResponse>;
  createServiceAccount(
    name: string,
    bindings: readonly ServiceBindingResponse[],
    signal?: AbortSignal,
  ): Promise<import('@proanima/arkvory-contracts').ServiceAccountResponse>;
  updateServiceAccount(
    id: string,
    expectedRevision: number,
    enabled: boolean,
    signal?: AbortSignal,
  ): Promise<import('@proanima/arkvory-contracts').ServiceAccountResponse>;
  setServicePolicy(
    id: string,
    expectedRevision: number,
    bindings: readonly ServiceBindingResponse[],
    signal?: AbortSignal,
  ): Promise<import('@proanima/arkvory-contracts').ServiceAccountResponse>;
  serviceKeys(
    id: string,
    after?: string,
    signal?: AbortSignal,
  ): Promise<{
    items: import('@proanima/arkvory-contracts').ApiKeyResponse[];
    next: string | null;
  }>;
  serviceKey(
    id: string,
    signal?: AbortSignal,
  ): Promise<import('@proanima/arkvory-contracts').ApiKeyResponse>;
  issueServiceKey(
    id: string,
    idempotencyKey: string,
    options: {
      name: string;
      bindings: readonly ServiceBindingResponse[];
      expiresAt?: string;
    },
    signal?: AbortSignal,
  ): Promise<{
    secret?: string;
    key: import('@proanima/arkvory-contracts').ApiKeyResponse;
  }>;
  rotateServiceKey(
    id: string,
    idempotencyKey: string,
    options: {
      name: string;
      bindings: readonly ServiceBindingResponse[];
      expiresAt?: string;
    },
    signal?: AbortSignal,
  ): Promise<{
    secret?: string;
    key: import('@proanima/arkvory-contracts').ApiKeyResponse;
  }>;
  revokeServiceKey(id: string, signal?: AbortSignal): Promise<void>;
  activateServiceKey(signal?: AbortSignal): Promise<void>;
  serviceAudit(
    id: string,
    after?: string,
    signal?: AbortSignal,
  ): Promise<
    {
      sequence: string;
      actor: string;
      action: string;
      accountId: string;
      keyId: string | null;
      occurredAt: string;
    }[]
  >;
  me(): Promise<import('@proanima/arkvory-contracts').PrincipalResponse>;
  logout(): Promise<void>;
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
  users(): Promise<import('@proanima/arkvory-contracts').AccountResponse[]>;
  createUser(
    name: string,
    password: string,
    administrator?: boolean,
  ): Promise<import('@proanima/arkvory-contracts').AccountResponse>;
  updateUser(
    id: string,
    update: {
      enabled?: boolean;
      password?: string;
    },
  ): Promise<import('@proanima/arkvory-contracts').AccountResponse>;
  accessGroups(): Promise<import('@proanima/arkvory-contracts').GroupResponse[]>;
  createAccessGroup(name: string): Promise<import('@proanima/arkvory-contracts').GroupResponse>;
  setGroupMember(groupId: string, userId: string, present: boolean): Promise<void>;
  setGroupGrant(
    groupId: string,
    repository: string,
    access: 'read' | 'write' | null,
  ): Promise<void>;
  packages(
    repository: string,
    query?: {
      group?: string;
      name?: string;
      sort?: 'group' | 'name' | 'version';
      direction?: 'asc' | 'desc';
      groupBy?: 'none' | 'group' | 'package';
      after?: string;
      limit?: number;
    },
  ): Promise<{
    items: readonly import('@proanima/arkvory-contracts').PackageResponse[];
    groups: readonly import('@proanima/arkvory-contracts').PackageGroupResponse[];
    next: string | null;
  }>;
  create(
    repository: string,
    key: string,
    descriptor: UploadResponse['descriptor'],
    signal?: AbortSignal,
  ): Promise<UploadResponse>;
  status(repository: string, id: string, signal?: AbortSignal): Promise<UploadResponse>;
  artifact(repository: string, id: string, signal?: AbortSignal): Promise<UploadResponse>;
  list(
    repository: string,
    after?: string,
  ): Promise<{
    items: UploadResponse[];
    next: string | null;
  }>;
  search(
    repository: string,
    query?: {
      q?: string;
      label?: string;
      collection?: string;
      after?: string;
    },
  ): Promise<{
    items: {
      id: string;
      name: string;
    }[];
    next: string | null;
  }>;
  attachments(
    repository: string,
    id: string,
    signal?: AbortSignal,
  ): Promise<import('@proanima/arkvory-contracts').AttachmentRevisionResponse>;
  replaceAttachments(
    repository: string,
    id: string,
    expectedRevision: number,
    items: readonly BuildAttachmentResponse[],
    signal?: AbortSignal,
  ): Promise<import('@proanima/arkvory-contracts').AttachmentRevisionResponse>;
  attachmentHistory(
    repository: string,
    id: string,
    before?: number,
    signal?: AbortSignal,
  ): Promise<import('@proanima/arkvory-contracts').AttachmentHistoryResponse>;
  annotations(repository: string, id: string): Promise<AnnotationsResponse>;
  annotate(
    repository: string,
    id: string,
    expectedRevision: number,
    value: Omit<AnnotationsResponse, 'revision'>,
  ): Promise<AnnotationsResponse>;
  parts(
    repository: string,
    id: string,
    signal?: AbortSignal,
  ): Promise<{
    partBytes: number;
    items: {
      index: number;
      size: number;
      sha256: string;
    }[];
  }>;
  complete(repository: string, id: string, signal?: AbortSignal): Promise<UploadResponse>;
  enqueue(
    repository: string,
    id: string,
  ): Promise<import('@proanima/arkvory-contracts').JobResponse>;
  job(id: string): Promise<import('@proanima/arkvory-contracts').JobResponse>;
  registerPackage(repository: string, id: string): Promise<Record<string, unknown>>;
  setAsset(
    repository: string,
    path: string,
    artifactId: string,
    expectedRevision: number,
  ): Promise<import('@proanima/arkvory-contracts').AssetResponse>;
  asset(
    repository: string,
    path: string,
  ): Promise<import('@proanima/arkvory-contracts').AssetResponse>;
  assetPage(
    repository: string,
    options?: {
      prefix?: string;
      after?: string;
      limit?: number;
    },
    signal?: AbortSignal,
  ): Promise<import('@proanima/arkvory-contracts').AssetPageResponse>;
  assetHistory(
    repository: string,
    path: string,
    before?: number,
    signal?: AbortSignal,
  ): Promise<import('@proanima/arkvory-contracts').AssetHistoryResponse>;
  assetRevision(
    repository: string,
    path: string,
    revision: number,
    signal?: AbortSignal,
  ): Promise<import('@proanima/arkvory-contracts').AssetRevisionResponse>;
  restoreAsset(
    repository: string,
    path: string,
    sourceRevision: number,
    expectedRevision: number,
    signal?: AbortSignal,
  ): Promise<import('@proanima/arkvory-contracts').AssetResponse>;
  cancel(repository: string, id: string): Promise<UploadResponse>;
  download(
    repository: string,
    id: string,
    range?: {
      start: number;
      end: number;
    },
    signal?: AbortSignal,
  ): Promise<Response>;
  resume(
    repository: string,
    id: string,
    file: Blob,
    options?: TransferOptions & {
      onProgress?: (bytes: number) => void;
    },
  ): Promise<UploadResponse>;
  downloadVerified(
    repository: string,
    id: string,
    options?: TransferOptions & {
      prefix?: Blob;
    },
  ): Promise<ReadableStream<Uint8Array>>;
}
