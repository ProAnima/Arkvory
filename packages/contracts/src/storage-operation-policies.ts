export const storageOperations = [
  ['/artifacts/{id}/deletion', 'get', 'inspectArtifactDeletion', ['artifact.delete'], 'read'],
  ['/artifacts/{id}', 'delete', 'deleteArtifact', ['artifact.delete'], 'idempotent'],
  ['/retention/preview', 'post', 'previewRetention', ['artifact.delete'], 'read'],
  ['/retention/apply', 'post', 'applyRetention', ['artifact.delete'], 'idempotent'],
  ['/storage/policy', 'get', 'getStoragePolicy', ['storage.read'], 'read'],
  ['/storage/policy', 'put', 'setStoragePolicy', ['storage.manage'], 'compare-and-swap'],
  ['/storage/usage', 'get', 'getStorageUsage', ['storage.read'], 'read'],
  ['/storage/preview', 'get', 'previewStoragePolicy', ['artifact.delete'], 'read'],
  [
    '/storage/run',
    'post',
    'runStoragePolicy',
    ['storage.manage', 'artifact.delete'],
    'never-automatic',
  ],
  ['/storage/events', 'get', 'getStorageEvents', ['diagnostics.read'], 'read'],
  ['/storage/cleanup', 'get', 'getCleanup', ['storage.read'], 'read'],
  ['/storage/cleanup', 'put', 'setCleanup', ['storage.manage'], 'compare-and-swap'],
  ['/storage/cleanup/run', 'post', 'requestCleanup', ['storage.manage'], 'never-automatic'],
] as const;

export const attachmentOperations = [
  ['', 'get', 'getBuildAttachments', ['annotation.read'], ['read'], 'read'],
  [
    '',
    'put',
    'replaceBuildAttachments',
    ['annotation.write', 'artifact.read'],
    ['read', 'write'],
    'compare-and-swap',
  ],
  ['/history', 'get', 'getBuildAttachmentHistory', ['annotation.read'], ['read'], 'read'],
] as const;
