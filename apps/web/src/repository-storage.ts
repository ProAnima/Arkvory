import type { ArkvoryClient } from '@proanima/arkvory-sdk';
import { installStoragePolicy } from './storage-policy.js';
import { installCleanup } from './cleanup.js';
import { installMirrorStatus } from './mirror-status.js';

export function installRepositoryStorage(client: ArkvoryClient) {
  const policies = installStoragePolicy(client),
    cleanup = installCleanup(client),
    mirror = installMirrorStatus(client);
  return {
    clear() {
      policies.clear();
      cleanup.clear();
      mirror.clear();
    },
    async connect(repository: string) {
      await Promise.all([
        policies.connect(repository),
        cleanup.connect(repository),
        mirror.connect(repository),
      ]);
    },
  };
}
